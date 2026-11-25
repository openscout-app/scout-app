/**
 * Terminal — a live shell or harness in a panel. It opens as a terminal.
 *
 * Shows:  the live terminal under a thin strip: what runs (Shell · Claude ·
 *         Codex · Pi) and where (Home or a project on this machine), status,
 *         Restart, End. Changing what or where starts a fresh terminal in
 *         place. After End, one quiet line offers to start it again.
 * Data:   hudsonkit's terminal relay over the Scout relay socket. Starting is
 *         just connecting: session:init spawns a fresh pty on this machine.
 * Scope:  per instance, kept in the view:
 *           agent    shell | claude | codex | pi   (default shell)
 *           cwd      the directory it starts in ("" = home)
 *           session  a nonce; a new one means a new terminal
 *           ended    "1" after End, until it is started again
 *         The relay session key is the instance id plus that nonce, so two
 *         Terminal panels never share (and fight over) one socket.
 * Opens:  nothing.
 *
 * Closing the view only detaches: the relay keeps the shell for its orphan
 * TTL (30 min) and the panel reattaches on return.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTerminalRelay } from "hudsonkit/terminal";
import { resolveScoutTerminalRelayHealthUrl, resolveScoutTerminalRelayUrl } from "../../../lib/runtime-config.ts";
import { destroyTerminalRelaySession, SCOUT_TERMINAL_INITIAL_COLS, SCOUT_TERMINAL_INITIAL_ROWS } from "../../../lib/terminal-relay.ts";
import { TypographicTerminalRelay } from "../../terminal/TypographicTerminalRelay.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { useLocalProjects } from "./projects.tsx";
import { baseName, pathLabels } from "./shared.tsx";

type TerminalAgent = "shell" | "claude" | "codex" | "pi";

export const TERMINAL_AGENTS: readonly { value: TerminalAgent; label: string }[] = [
  { value: "shell", label: "Shell" },
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "pi", label: "Pi" },
];

const isTerminalAgent = (v: string | undefined): v is TerminalAgent => TERMINAL_AGENTS.some((a) => a.value === v);
const labelOf = (agent: TerminalAgent) => TERMINAL_AGENTS.find((a) => a.value === agent)?.label ?? agent;

// the clock alone repeats inside one millisecond; the count never does
let starts = 0;

/** The settings that start a terminal. A fresh nonce each call, even twice in one millisecond. */
export function startTerminal(agent: TerminalAgent, cwd: string): Record<string, string> {
  starts += 1;
  // shell is the default, so it is stored as nothing
  return { agent: agent === "shell" ? "" : agent, cwd, session: `${Date.now().toString(36)}${starts.toString(36)}`, ended: "" };
}

/** What runs and where: two quiet selects. Changing either starts a fresh terminal there. */
function Where({ agent, cwd, onChange }: { agent: TerminalAgent; cwd: string; onChange: (agent: TerminalAgent, cwd: string) => void }) {
  const { rows } = useLocalProjects();
  // "~" is Home, which is already the first choice
  const roots = rows.map((r) => r.root).filter((r) => r !== "~");
  // a directory chosen earlier stays listed even if no agent works there now
  if (cwd && !roots.includes(cwd)) roots.push(cwd);
  const labels = pathLabels(roots);
  return (
    <>
      <select className="vw-term-pick" value={agent} onChange={(e) => onChange(e.target.value as TerminalAgent, cwd)} aria-label="What runs">
        {TERMINAL_AGENTS.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>
      <select className="vw-term-pick vw-term-pick--where" value={cwd} onChange={(e) => onChange(agent, e.target.value)} aria-label="Where" title={cwd || "Home"}>
        <option value="">~ Home</option>
        {roots.map((root) => (
          <option key={root} value={root}>
            {labels.get(root) ?? baseName(root)}
          </option>
        ))}
      </select>
    </>
  );
}

function LiveTerminal({ instanceId, agent, cwd, session, setConfig }: { instanceId: string; agent: TerminalAgent; cwd: string; session: string } & Pick<ModuleProps, "setConfig">) {
  const body = useRef<HTMLDivElement>(null);
  const relay = useTerminalRelay({
    url: resolveScoutTerminalRelayUrl(),
    healthUrl: resolveScoutTerminalRelayHealthUrl(),
    autoConnect: true,
    sessionKey: `scout-view-terminal-${instanceId}-${session}`,
    backend: "pty",
    agent,
    ...(cwd ? { cwd } : {}),
    controlMode: "takeover",
    // hudsonkit types agent as claude | pi | shell; the Scout relay also runs codex
  } as unknown as Parameters<typeof useTerminalRelay>[0]);

  useLayoutEffect(() => {
    relay.resize(SCOUT_TERMINAL_INITIAL_COLS, SCOUT_TERMINAL_INITIAL_ROWS);
  }, [relay.resize]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * End and Restart kill this pty for good; the relay would otherwise keep it
   * for its orphan TTL. The relay names the pty only once it is ready, so a
   * kill asked for mid-handshake waits for the name (or for the handshake to
   * fail) before it disconnects, and only then moves on.
   */
  const [then, setThen] = useState<(() => void) | null>(null);
  const settle = useRef(false);
  useEffect(() => {
    if (!then || settle.current) return;
    const finish = () => {
      settle.current = true;
      const id = relay.sessionId;
      relay.disconnect();
      if (id) void destroyTerminalRelaySession(id).catch(() => {});
      then();
    };
    if (relay.sessionId || relay.status !== "connecting") return finish();
    // a handshake that never answers still lets the panel move on
    const t = window.setTimeout(finish, 5000);
    return () => window.clearTimeout(t);
  }, [then, relay.sessionId, relay.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const end = () => setThen(() => () => setConfig({ session: "", ended: "1" }));
  const restartIn = (nextAgent: TerminalAgent, nextCwd: string) => setThen(() => () => setConfig(startTerminal(nextAgent, nextCwd)));

  const focus = () => body.current?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")?.focus();

  return (
    <div className="vw-term">
      <div className="vw-term-strip">
        <Where agent={agent} cwd={cwd} onChange={restartIn} />
        <span className={`vw-term-status vw-term-status--${relay.status}`}>{then ? "ending" : relay.status === "connected" ? "" : relay.status}</span>
        <button type="button" className="vw-chip" onClick={() => restartIn(agent, cwd)} disabled={!!then}>
          Restart
        </button>
        <button type="button" className="vw-chip" onClick={end} disabled={!!then}>
          End
        </button>
      </div>
      <div className="vw-term-body" ref={body} onMouseDown={focus}>
        <TypographicTerminalRelay relay={relay} search={typeof window === "undefined" ? "" : window.location.search} />
      </div>
    </div>
  );
}

function Terminal({ instanceId, config, setConfig }: ModuleProps) {
  const agent = isTerminalAgent(config.agent) ? config.agent : "shell";
  const cwd = config.cwd ?? "";
  const ended = config.ended === "1";
  // a fresh panel is a terminal from the first frame: start one rather than ask
  useEffect(() => {
    if (!config.session && !ended) setConfig(startTerminal(agent, cwd));
  }, [config.session, ended]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ended) {
    return (
      <div className="vw-term-ended">
        <span className="vw-dim">
          {labelOf(agent)} ended{cwd ? ` in ${baseName(cwd)}` : ""}.
        </span>
        <button type="button" className="vw-chip" onClick={() => setConfig(startTerminal(agent, cwd))}>
          Start again
        </button>
      </div>
    );
  }
  if (!config.session) return <div className="vw-term" />;
  return <LiveTerminal key={config.session} instanceId={instanceId} agent={agent} cwd={cwd} session={config.session} setConfig={setConfig} />;
}

export const terminalModule = defineModule({
  type: "terminal",
  title: "Terminal",
  blurb: "A live shell or harness, open from the first frame",
  docs: {
    shows: "The live terminal under a strip: what runs (Shell · Claude · Codex · Pi), where, Restart, End.",
    data: "hudsonkit terminal relay; a fresh pty per panel, keyed by instance.",
    opens: "Nothing.",
  },
  size: { w: 6, h: 14 },
  minSize: { w: 4, h: 8 },
  state: ["session", "ended"],
  Component: Terminal,
});
