/**
 * Scoutbot: the companion's one front door. Every request that reaches the
 * operator (questions, approvals, permission requests) comes to Scoutbot and is
 * answered there; agent figures do not hold queues of their own.
 *
 * The drawing is Lookout II from the Studio study (design/studio/views/
 * scoutbot-character.tsx): a squat hex body with two tall eyes on a 100-unit
 * grid. This is the evergreen state; the full turtle-style character with
 * limbs comes from the motion study and replaces the body here when ported.
 */
import { useId, useState, type CSSProperties } from "react";
import { openFromCompanion } from "../../lib/companion-host.ts";
import type { OperatorAttentionAction, OperatorAttentionItem, OperatorAttentionState } from "../../lib/types.ts";
import { PaneView } from "../../components/PaneView.tsx";
import { TerminalScreen } from "../../components/TerminalScreen.tsx";
import { leadApprove, panePromptNote, requestActionLabel, requestActions, requestActionTitle, requestKind, requestUpdatedAge, terminalScreen } from "../requests/requests-model.ts";
import { OPENED_HERE, revealRequestSession } from "../requests/request-session.ts";
import { type RequestDelivery, useRequestActions } from "../requests/use-request-actions.ts";
import { RequestProgress } from "../requests/RequestProgress.tsx";
import "./scoutbot.css";
import { permissionPresentation } from "../../lib/permission-presentation.ts";

export type ScoutbotMood = "rest" | "ask";

type Pt = [number, number];

/** A closed polygon with its corners rounded by quadratic curves of radius r (grid units). */
function rounded(pts: Pt[], r: number): string {
  const n = pts.length;
  const cut = (a: Pt, b: Pt, d: number): Pt => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len];
  };
  let d = "";
  for (let i = 0; i < n; i++) {
    const cur = pts[i]!;
    const a = cut(cur, pts[(i - 1 + n) % n]!, r);
    const b = cut(cur, pts[(i + 1) % n]!, r);
    d += `${i === 0 ? "M" : "L"}${a[0].toFixed(2)} ${a[1].toFixed(2)} Q${cur[0]} ${cur[1]} ${b[0].toFixed(2)} ${b[1].toFixed(2)} `;
  }
  return d + "Z";
}

const BODY = rounded([[29, 22], [71, 22], [91, 54], [71, 86], [29, 86], [9, 54]], 10);

export type ScoutbotLook = "graphite" | "bone" | "fog";
type Way = { name: string; top: string; bottom: string; eye: string; line: string; night: string; foot: string; light: number };
export const SCOUTBOT_LOOKS: Record<ScoutbotLook, Way> = {
  graphite: { name: "Graphite", top: "#3a3e44", bottom: "#24272b", eye: "#f4efe5", line: "#5c6168", night: "#62676f", foot: "#1a1c1f", light: 0.16 },
  bone: { name: "Bone", top: "#faf6ee", bottom: "#e9e2d4", eye: "#1b1d20", line: "#3a3c40", night: "#8d8f95", foot: "#3a3c40", light: 0.7 },
  fog: { name: "Fog", top: "#eef1f3", bottom: "#d3d9de", eye: "#1a1d21", line: "#363a40", night: "#8b9099", foot: "#363a40", light: 0.7 },
};
export const SCOUTBOT_LOOK_ORDER: ScoutbotLook[] = ["graphite", "bone", "fog"];

/** The drawing. On the desktop the ground is unknown, so the outline is the night grey. */
export function ScoutbotFigure({ look, mood, size, working = false }: { look: ScoutbotLook; mood: ScoutbotMood; size: number; working?: boolean }) {
  const way = SCOUTBOT_LOOKS[look];
  const gid = useId().replace(/:/g, "");
  // Thicker as it shrinks so the edge survives at cue size: the strip's 22-point face gets a full device pixel at 1x.
  const line = size <= 24 ? 4.6 : size <= 32 ? 3.6 : size <= 48 ? 2.8 : 2.2;
  const asking = mood === "ask";
  return (
    <svg className={`sbt-bot is-${mood}`} width={size} height={size} viewBox="0 -4 104 104" aria-hidden="true">
      <defs>
        <linearGradient id={`sbt${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={way.top} />
          <stop offset="1" stopColor={way.bottom} />
        </linearGradient>
      </defs>
      <ellipse cx="50" cy="93" rx="22" ry="2.8" className="sbt-shadow" />
      <g className="sbt-pose">
        {[37, 63].map((x) => (
          <rect key={x} x={x - 4.5} y={82} width={9} height={7.5} rx={3.2} fill={way.foot} stroke={way.night} strokeWidth={line * 0.5} />
        ))}
        <path d={BODY} fill={`url(#sbt${gid})`} />
        <path d={BODY} fill="none" stroke={way.night} strokeWidth={line} strokeLinejoin="round" />
        <path d="M33 26.5 H67" stroke="#fff" strokeOpacity={way.light} strokeWidth={1.2} strokeLinecap="round" />
        {working ? <g className="sbt-current" fill="none" stroke={way.eye} strokeLinecap="round" pointerEvents="none">
          <path d={BODY} className="sbt-current__rim" strokeWidth={line} opacity={0.18} />
          <g className="sbt-current__flow">
            <path d={BODY} pathLength={100} strokeDasharray="8 92" strokeWidth={line * 1.15} />
          </g>
        </g> : null}
        <g className="sbt-eyes" style={{ transform: `translateY(${asking ? -3.5 : 0}px)` }}>
          <g className="sbt-blink">
            {[37, 63].map((cx) => <ellipse key={cx} cx={cx} cy={55} rx={6} ry={13} fill={way.eye} />)}
          </g>
        </g>
        {asking ? (
          <g className="sbt-dot">
            <circle cx="84" cy="22" r="8.6" fill={way.bottom} stroke={way.night} strokeWidth={line * 0.5} />
            <circle cx="84" cy="22" r="6" className="sbt-dot__fill" />
            <circle cx="84" cy="22" r="6" className="sbt-dot__ring" />
          </g>
        ) : null}
      </g>
    </svg>
  );
}

/** Scoutbot's look, kept on this Mac by the companion page. Where it stands is the host's (its figure). */
export type ScoutbotPrefs = {
  name: string;
  look: ScoutbotLook;
  size: number;
  /** The hex tool's size in points. */
  hex: number;
  /** Speak replies and announce new requests. */
  voice: boolean;
};
export const SCOUTBOT_SIZES = [32, 40, 52] as const;
export const HEX_SIZES = [{ size: 26, label: "Small" }, { size: 32, label: "Medium" }, { size: 40, label: "Large" }] as const;
export const DEFAULT_SCOUTBOT: ScoutbotPrefs = { name: "Scoutbot", look: "graphite", size: 40, hex: 32, voice: false };
const STORAGE_KEY = "scout.companion.scoutbot";

export function readScoutbotPrefs(): ScoutbotPrefs {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "null") as Partial<ScoutbotPrefs> | null;
    if (!raw || typeof raw !== "object") return DEFAULT_SCOUTBOT;
    return {
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 24) : DEFAULT_SCOUTBOT.name,
      look: raw.look && raw.look in SCOUTBOT_LOOKS ? raw.look : DEFAULT_SCOUTBOT.look,
      size: SCOUTBOT_SIZES.includes(raw.size as typeof SCOUTBOT_SIZES[number]) ? raw.size! : DEFAULT_SCOUTBOT.size,
      hex: HEX_SIZES.some((option) => option.size === raw.hex) ? raw.hex! : DEFAULT_SCOUTBOT.hex,
      voice: raw.voice === true,
    };
  } catch {
    return DEFAULT_SCOUTBOT;
  }
}

export function writeScoutbotPrefs(prefs: ScoutbotPrefs): void {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* private mode: keep it for this run */ }
}

/** The conversation a request's "open" action leads to, when it names one. */
function conversationOf(item: OperatorAttentionItem, action: OperatorAttentionAction | undefined): string | null {
  const route = action?.route as { conversationId?: string } | undefined;
  return route?.conversationId ?? item.conversationId ?? null;
}

export function openConversation(conversationId: string) {
  void openFromCompanion("thread", { workId: conversationId, conversationId }).catch(() => {});
}

export function ScoutbotRequest({ item, now, focused = false }: {
  item: OperatorAttentionItem;
  now: number;
  /** The request a native notification click opened; lit briefly on arrival. */
  focused?: boolean;
}) {
  const presentation = permissionPresentation(item);
  const actions = requestActions(item);
  const opener = actions.find((action) => action.kind === "open");
  const conversationId = conversationOf(item, opener);
  const { busy, stalled, error, sent, delivery, answer, act, retry } = useRequestActions(item, () => { if (conversationId) openConversation(conversationId); });
  const decisions = actions.filter((action) => action.kind !== "open");
  const lead = leadApprove(decisions);
  // A prompt captured from a pane reads as the terminal drew it.
  const summaryScreen = presentation ? null : terminalScreen(item.summary);
  const detailScreen = presentation || summaryScreen ? null : terminalScreen(item.detail);
  // A permission names the session that asked: go there, not to the ask's chat.
  const [going, setGoing] = useState(false);
  const [goLine, setGoLine] = useState<string | null>(null);
  const goToSession = item.permission ? async () => {
    if (going) return;
    setGoing(true); setGoLine(null);
    // Opened in the companion's pop-up: the pop-up says so itself.
    try { const { line } = await revealRequestSession(item.permission!.requestId); setGoLine(line === OPENED_HERE ? null : line); }
    finally { setGoing(false); }
  } : null;
  // Once delivered or ended, the outcome stands in for the chips; every other
  // state keeps the chips so the operator can still decide or open the source.
  const settled = delivery?.state === "delivered" || delivery?.state === "ended" || Boolean(sent);
  return (
    <article className={`sbt-req${focused ? " is-focused" : ""}`} data-request-id={item.id} aria-busy={busy} aria-current={focused || undefined}>
      <header>
        <span className="sbt-req__kind">{requestKind(item)}</span>
        <span className="sbt-req__who">{item.agentName ?? item.agentId ?? "Agent not supplied"} · {requestUpdatedAge(item.updatedAt, now)}</span>
      </header>
      <h3>{presentation ? "Run this command?" : item.title}</h3>
      {presentation ? <>
        {presentation.reason ? <p>{presentation.reason}</p> : null}
        <pre className="sbt-req__command" tabIndex={0} aria-label="Command to approve"><code>{presentation.command}</code></pre>
        <p className="sbt-req__folder"><span>Working folder</span>{presentation.cwd}</p>
      </> : item.pane?.backend === "tmux" ? <>
        {/* A prompt on a tmux pane: the pane itself, live, which Jump in answers. A Herdr pane has no live view
            here: its capture is drawn below, with Yes / No. */}
        {!summaryScreen && item.summary && item.summary !== item.title ? <p>{item.summary}</p> : null}
        <PaneView pane={item.pane} who={item.agentName} fallback={summaryScreen ?? detailScreen} lead={!item.pane.prompt?.answerable} />
        {panePromptNote(item.pane) ? <p>{panePromptNote(item.pane)}</p> : null}
      </> : <>
        {summaryScreen ? <TerminalScreen lines={summaryScreen} />
          : item.summary && item.summary !== item.title ? <p>{item.summary}</p> : null}
        {detailScreen ? <TerminalScreen lines={detailScreen} />
          : item.detail && item.detail !== item.summary ? <p className="sbt-req__detail">{item.detail}</p> : null}
      </>}
      <div className="sbt-req__acts">
        {settled ? <DeliveryState delivery={delivery ?? { state: "delivered", label: sent ?? "" }} />
          : item.answer?.options.map((option) => (
            <button key={`answer:${option}`} type="button" className="sbt-chip" disabled={busy} onClick={() => void answer(option)}>{option}</button>
          ))}
        {!settled && decisions.map((action, index) => (
          <button key={`${action.kind}:${index}`} type="button" className={`sbt-chip${action === lead ? " is-go" : ""}`} disabled={busy} onClick={() => void act(action)}
            title={requestActionTitle(item, action)}>
            {requestActionLabel(action)}
          </button>
        ))}
        {goToSession ? (
          <button type="button" className="sbt-open" title="Go to the session's terminal" disabled={going} onClick={() => void goToSession()}>
            Session <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 8 8 4M4.5 4H8v3.5" /></svg>
          </button>
        ) : null}
        {conversationId ? (
          <button type="button" className="sbt-open" title={item.answer ? "Reply in the conversation" : "Open the conversation"} onClick={() => openConversation(conversationId)}>
            {goToSession ? "Chat" : "Open"} <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 8 8 4M4.5 4H8v3.5" /></svg>
          </button>
        ) : null}
      </div>
      {presentation ? <details className="sbt-req__technical">
        <summary>Request details</summary>
        <pre tabIndex={0} aria-label="Full permission request">{item.summary}</pre>
        {item.detail ? <p className="sbt-req__detail">{item.detail}</p> : null}
      </details> : null}
      {goLine ? <p className="sbt-req__detail" role="status">{goLine}</p> : null}
      {delivery && !settled && (busy || delivery.state === "sending" || delivery.state === "unconfirmed")
        ? <RequestProgress delivery={delivery} busy={busy} stalled={stalled} onRetry={() => void retry()} />
        : delivery && !settled ? <DeliveryState delivery={delivery} />
        : error && !settled ? <p className="sbt-req__error" role="alert">{error}</p> : null}
    </article>
  );
}

const DELIVERY_WORD: Record<RequestDelivery["state"], string> = {
  sending: "Sending",
  delivered: "Sent",
  refused: "Refused",
  ended: "Ended",
  unconfirmed: "Unconfirmed",
};

/** One typographic line for where a decision stands: word · choice · why. */
function DeliveryState({ delivery }: { delivery: RequestDelivery }) {
  const note = delivery.state === "refused" || delivery.state === "ended" ? delivery.reason
    : delivery.state === "unconfirmed" ? "no reply from Scout. Check the session before deciding again."
      : null;
  return (
    <p className={`sbt-req__state is-${delivery.state}`} role={delivery.state === "refused" || delivery.state === "unconfirmed" ? "alert" : "status"}>
      <b>{DELIVERY_WORD[delivery.state]}</b>
      {delivery.label ? <span>{delivery.label}</span> : null}
      {note ? <em>{note}</em> : null}
    </p>
  );
}

/** The side card: the newest request, held up beside Scoutbot at head height. */
export function ScoutbotCard({ item, more, side, style, onOpen }: {
  item: OperatorAttentionItem;
  more: number;
  side: "left" | "right";
  style: CSSProperties;
  onOpen: () => void;
}) {
  return (
    <button type="button" className={`sbt-card is-${side}`} data-hit="scoutbot-card" style={style} onClick={onOpen}
      aria-label={`${requestKind(item)}: ${item.title}${more ? `, ${more} more` : ""}`}>
      <small>{requestKind(item)}</small>
      <span>{item.title}</span>
      <em>{item.agentName ?? item.agentId ?? "Agent"}{more ? ` · +${more} more` : ""}</em>
    </button>
  );
}

/** Scoutbot's settings rows, shown in the companion settings sheet. */
export function ScoutbotSettings({ prefs, placed, onChange, onHome }: {
  prefs: ScoutbotPrefs;
  /** Whether Scoutbot stands somewhere other than beside the hex. */
  placed: boolean;
  onChange: (patch: Partial<ScoutbotPrefs>) => void;
  onHome: () => void;
}) {
  const [draft, setDraft] = useState(prefs.name);
  return (
    <section className="co-sheet sbt-settings" aria-label="Scoutbot">
      <div className="co-field">
        <span className="co-sheet-h" id="sbt-hex-size">Hex size</span>
        <div className="co-seg" role="radiogroup" aria-labelledby="sbt-hex-size">
          {HEX_SIZES.map((option) => (
            <button key={option.size} type="button" role="radio" aria-checked={prefs.hex === option.size} className="co-seg-btn"
              onClick={() => onChange({ hex: option.size })}>{option.label}</button>
          ))}
        </div>
      </div>
      <div className="co-field">
        <label className="co-sheet-h" htmlFor="sbt-name">Name</label>
        <input id="sbt-name" className="sbt-name" value={draft} maxLength={24} spellCheck={false}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => onChange({ name: draft.trim() || DEFAULT_SCOUTBOT.name })}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      </div>
      <div className="co-field">
        <span className="co-sheet-h" id="sbt-look">Look</span>
        <div className="sbt-looks" role="radiogroup" aria-labelledby="sbt-look">
          {SCOUTBOT_LOOK_ORDER.map((look) => (
            <button key={look} type="button" role="radio" aria-checked={prefs.look === look} className="sbt-look" onClick={() => onChange({ look })}>
              <ScoutbotFigure look={look} mood="rest" size={30} />
              <span>{SCOUTBOT_LOOKS[look].name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="co-field">
        <span className="co-sheet-h" id="sbt-size">Size</span>
        <div className="co-seg" role="radiogroup" aria-labelledby="sbt-size">
          {SCOUTBOT_SIZES.map((size) => (
            <button key={size} type="button" role="radio" aria-checked={prefs.size === size} className="co-seg-btn"
              aria-label={`${size} points`} onClick={() => onChange({ size })}>{size}</button>
          ))}
        </div>
        <p className="co-hint">Every question and permission request comes to {prefs.name}. Drag it anywhere; hold &#x2325; as you let go to stick it to the nearest edge or window, &#x21E7; to drop it onto whatever is below.</p>
      </div>
      <div className="co-foot">
        <button type="button" className="co-chip" disabled={!placed} onClick={onHome}>Back beside the hex</button>
      </div>
    </section>
  );
}

/**
 * Browser preview only (no Mac host): `?requests=sample` fills the queue with
 * two example requests so the filled state can be reviewed. Never used in the app.
 */
export function previewRequests(): OperatorAttentionState | null {
  if (typeof location === "undefined" || new URLSearchParams(location.search).get("requests") !== "sample") return null;
  const now = Date.now();
  const base = { summary: null, detail: null, conversationId: null, severity: "info" as const, actions: [] };
  return {
    generatedAt: now,
    totals: { all: 2, approvals: 0, configuration: 1, collaboration: 1 },
    items: [
      // As a harness prompt caught on its pane arrives: the screen as the summary, every decision it offers.
      { ...base, id: "sample-permission", kind: "question", title: "Permission request", agentId: "core", agentName: "core", updatedAt: now - 4 * 60_000, sourceLabel: "Permission request",
        summary: "Bash command\n\n  git push origin broker/sqlite-off-loop\n  Push the branch for review\n\nDo you want to proceed?\n ❯ 1. Yes\n   2. Yes, and don't ask again for git push commands in /example/workstation-user/dev/openscout/scout\n   3. No, and tell Claude what to do differently (esc)\n\nEsc to cancel · Tab to amend",
        detail: "/example/workstation-user/dev/openscout/scout · sample",
        permission: { requestId: "sample", version: "v1", sessionId: "sample", projectRoot: "/example/workstation-user/dev/openscout/scout" },
        actions: [{ kind: "approve", label: "Allow once", value: "once" }, { kind: "approve", label: "Allow always", value: "project" }, { kind: "deny", label: "Deny", value: "deny" }] },
      { ...base, id: "sample-ask", kind: "question", title: "iPad drawer: should focus land on the first thread or the composer?", agentId: "ios", agentName: "ios", updatedAt: now - 60_000, sourceLabel: "Question",
        answer: { conversationId: "sample", replyToMessageId: "sample", options: ["First thread", "Composer"] } },
    ],
  };
}
