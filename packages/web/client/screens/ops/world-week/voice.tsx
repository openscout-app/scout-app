import { hostEventSource } from "../../../lib/hosts/host-fleet.ts";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { api } from "../../../lib/api.ts";
import { takeWorldCommands } from "../../../lib/world-command.ts";
import { startScoutSpeech, type ScoutSpeechHandle } from "../../../lib/scout-voice.ts";
import type { WorldHandle } from "./engine.ts";

/*
 * Words → the HUD's ":" line. Typed words that aren't a verb (the engine hands
 * them over through onFreeText) and always-on voice (`world.command` UI actions)
 * both go to POST /api/ops/world-command with what the HUD knows; whatever comes
 * back runs through runCommand. A quiet echo says what ran; a low-confidence
 * guess waits for Enter (run) or Esc (drop). While mounted and visible the page
 * holds a presence stream so always-on voice knows the World is open.
 *
 * Questions ("what happened wednesday?", ":tell me who's stuck") go to POST /api/ops/world-ask with the HUD's brief
 * instead: the answer stays on the echo line while it is read aloud, and its moves run one by one so the camera
 * shows what is being said. Esc stops it.
 */

type Proposal = { verb: string; commands: string[]; echo: string; confidence: number };
type Result =
  | ({ status: "ok"; engine: string } & Proposal)
  | { status: "confirm"; engine: string; proposal: Proposal }
  | { status: "none"; engine: string; echo: string };
type Echo = { kind: "busy" | "ok" | "none" | "confirm" | "say"; line: string; note?: string; proposal?: Proposal };
type Answer = { say: string; commands: string[]; model: string };

const ECHO_MS = 3_600, CONFIRM_MS = 12_000, MOVE_GAP_MS = 1_600;
// a question for the World rather than a move: ends in "?" or opens like one
const QUESTION = /\?\s*$|^(what|what's|whats|who|who's|whose|why|how|when|where|which|is|are|was|were|did|does|do|has|have|can|could|should|anything|any|tell me|explain|show me what|walk me through)\b/i;
export const isWorldQuestion = (text: string) => QUESTION.test(text.trim());

export function useWorldWords(world: RefObject<WorldHandle | null>, ready: boolean) {
  const [echo, setEcho] = useState<Echo | null>(null);
  const confirmRef = useRef<Proposal | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);

  const speech = useRef<ScoutSpeechHandle | null>(null);
  const moves = useRef<ReturnType<typeof setTimeout>[]>([]);
  const hush = useCallback(() => {
    speech.current?.stop(); speech.current = null;
    moves.current.forEach(clearTimeout); moves.current = [];
  }, []);

  // ms: how long it stays; null holds it until something replaces it
  const show = useCallback((next: Echo | null, ms?: number | null) => {
    clearTimeout(timer.current);
    confirmRef.current = next?.kind === "confirm" ? next.proposal ?? null : null;
    setEcho(next);
    const hold = ms !== undefined ? ms : next && next.kind !== "busy" ? (next.kind === "confirm" ? CONFIRM_MS : ECHO_MS) : null;
    if (next && hold != null) timer.current = setTimeout(() => { confirmRef.current = null; setEcho(null); }, hold);
  }, []);

  const run = useCallback((commands: string[], note?: string) => {
    const handle = world.current;
    if (!handle) return;
    for (const line of commands) handle.runCommand(line);
    show({ kind: "ok", line: ":" + commands.join("  ·  :"), note });
  }, [show, world]);

  // a question: the World answers out loud and shows what it means
  const ask = useCallback(async (text: string) => {
    const handle = world.current;
    if (!handle) return;
    const mine = ++seq.current;
    hush();
    show({ kind: "busy", line: text.toLowerCase(), note: "ASKING THE WORLD …" });
    let res: Answer;
    try {
      res = await api<Answer>("/api/ops/world-ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, brief: handle.brief() }),
      });
    } catch (error) {
      if (mine === seq.current) show({ kind: "none", line: "THE WORLD COULDN'T ANSWER", note: error instanceof Error ? error.message.toUpperCase() : undefined }, 6_000);
      return;
    }
    if (mine !== seq.current) return; // a newer question won
    // the moves: the first right away, the rest paced under the voice
    res.commands.forEach((line, i) => { moves.current.push(setTimeout(() => world.current?.runCommand(line), i * MOVE_GAP_MS)); });
    const readMs = 2_500 + res.say.length * 55;
    show({ kind: "say", line: res.say, note: res.commands.length ? ":" + res.commands.join("  ·  :") : undefined }, null);
    const done = () => { if (mine === seq.current) show({ kind: "say", line: res.say }, 2_500); };
    try {
      const handleSpeech = startScoutSpeech(res.say, { originAppId: "scout.world" });
      speech.current = handleSpeech;
      handleSpeech.promise.then(done, () => { if (mine === seq.current) show({ kind: "say", line: res.say }, readMs); });
    } catch {
      show({ kind: "say", line: res.say }, readMs);
    }
  }, [hush, show, world]);

  const resolve = useCallback(async (text: string) => {
    const handle = world.current;
    if (!handle) return;
    if (isWorldQuestion(text)) { void ask(text); return; }
    const mine = ++seq.current;
    hush();
    show({ kind: "busy", line: text.toLowerCase(), note: "…" });
    let res: Result;
    try {
      res = await api<Result>("/api/ops/world-command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, context: handle.state() }),
      });
    } catch {
      if (mine === seq.current) show({ kind: "none", line: "COULDN'T RESOLVE · " + text.toUpperCase() });
      return;
    }
    if (mine !== seq.current) return; // a newer utterance won
    const engine = res.engine === "fallback" ? "KEYWORDS" : res.engine.toUpperCase();
    if (res.status === "ok") run(res.commands, `${engine} ${Math.round(res.confidence * 100)}`);
    else if (res.status === "confirm") show({ kind: "confirm", line: ":" + res.proposal.commands.join("  ·  :"), note: `${engine} ${Math.round(res.proposal.confidence * 100)}`, proposal: res.proposal });
    else show({ kind: "none", line: res.echo });
  }, [ask, hush, run, show, world]);

  // Enter runs a pending guess, Esc drops it. Registered at mount, so it runs before the engine's own window listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc while the World is talking: stop the voice and the tour, keep the camera where it is
      if (e.key === "Escape" && (speech.current || moves.current.length)) {
        const a = document.activeElement;
        if (a && a.matches("input, textarea, select, [contenteditable='true']")) return;
        e.preventDefault(); e.stopImmediatePropagation(); seq.current++; hush(); show(null); return;
      }
      const proposal = confirmRef.current;
      if (!proposal || (e.key !== "Enter" && e.key !== "Escape")) return;
      const a = document.activeElement;
      if (a && a.matches("input, textarea, select, [contenteditable='true']")) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key === "Enter") run(proposal.commands, "CONFIRMED");
      else show(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => { seq.current++; window.removeEventListener("keydown", onKey, true); clearTimeout(timer.current); hush(); };
  }, [hush, run, show]);

  // world.command actions (voice, Scoutbot): literal lines run as given, words resolve here
  useEffect(() => {
    if (!ready) return;
    return takeWorldCommands((action) => {
      // ⌥ held on a pointed session (or a frozen frame): the words are for it, not for the HUD's command line
      const handle = world.current;
      if (action.text && handle?.psListening?.()) { handle.psHeard?.(action.text); return; }
      if (action.commands?.length) { seq.current++; hush(); run(action.commands, "VOICE"); }
      else if (action.text) void resolve(action.text);
    });
  }, [hush, ready, resolve, run, world]);

  // presence: always-on voice sends HUD moves here only while a World page is open and visible
  useEffect(() => {
    if (!ready || typeof EventSource === "undefined") return;
    let source: EventSource | null = null;
    const sync = () => {
      const visible = document.visibilityState === "visible";
      if (visible && !source) source = hostEventSource("/api/voice/ambient/actions?presence=world");
      else if (!visible && source) { source.close(); source = null; }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => { document.removeEventListener("visibilitychange", sync); source?.close(); };
  }, [ready]);

  // stable, so the engine can hold it from mount
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const onFreeText = useCallback((text: string) => { void resolveRef.current(text); }, []);
  const askRef = useRef(ask);
  askRef.current = ask;
  const onAsk = useCallback((text: string) => { void askRef.current(text); }, []);
  return { onFreeText, onAsk, echo };
}

const FONT_SIZE = 8.5;
/** The quiet line above the status bar: what ran, or the guess waiting for Enter. */
export function WorldEcho({ echo }: { echo: Echo | null }) {
  if (!echo) return null;
  const confirm = echo.kind === "confirm", say = echo.kind === "say";
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "absolute", left: 16, bottom: 34, zIndex: 25, maxWidth: "min(70%, 720px)",
        display: "flex", gap: 10, alignItems: "baseline", padding: "3px 8px",
        font: `300 ${FONT_SIZE}px/1.5 var(--wm-font), ui-monospace, monospace`, letterSpacing: "0.1em",
        color: echo.kind === "none" ? "var(--dim)" : "var(--fg)",
        background: "rgba(5,7,6,0.88)", border: `1px solid ${confirm ? "var(--accent-dim)" : "var(--line)"}`,
        whiteSpace: say ? "normal" : "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none",
        ...(say ? { flexWrap: "wrap" as const, fontSize: FONT_SIZE + 2, lineHeight: 1.55, letterSpacing: "0.04em", padding: "6px 10px", maxWidth: "min(70%, 640px)" } : {}),
      }}
    >
      {confirm && <span style={{ color: "var(--accent)" }}>Did you mean</span>}
      {say && <span style={{ color: "var(--accent)", fontSize: FONT_SIZE, letterSpacing: "0.2em" }}>World</span>}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", ...(say ? { flexBasis: "100%" } : {}) }}>{echo.line}</span>
      {echo.note && <span style={{ color: "var(--faint)" }}>{echo.note}</span>}
      {confirm && <span style={{ color: "var(--faint)" }}>↵ RUN · ESC DROP</span>}
    </div>
  );
}
