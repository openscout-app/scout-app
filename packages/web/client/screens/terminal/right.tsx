// its Sharp look hooks (s-term-right-*) live in the Terminal sheet; the inspector can mount without that screen
import "./terminal-screen.css";
import { useEffect, useState, type ReactNode } from "react";
import { useScout } from "../../scout/Provider.tsx";
import { agentStateLabel } from "../../lib/agent-state.ts";
import { timeAgo } from "../../lib/time.ts";
import { formatLabel } from "../../lib/text.ts";
import type { Agent, Route } from "../../lib/types.ts";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { resolveAgentTerminalSurface } from "../../lib/terminal-relay.ts";
import {
  fetchTerminalSessions,
  isRelayCapableTerminalBackend,
  resolveRegisteredTerminalTarget,
  terminalSummaryDetailRows,
  terminalSurfaceDescriptorFromRegisteredSurface,
  type RegisteredTerminalTarget,
} from "../../lib/terminal-sessions.ts";
import {
  agentForSurface,
  attachCommandFor,
  attachCommandForSurface,
  targetKind,
  type TerminalRoute,
} from "../views/modules/terminal-target-model.ts";
import { terminalMode } from "../views/modules/terminal-page-model.ts";
import {
  markedHarness,
  terminalAgentRow,
  type TerminalNavRowMark,
  type TerminalNavRowModel,
} from "./terminal-nav-row.ts";
import { TerminalRowMark, useTerminalRowIdentity } from "./terminal-row-identity.tsx";

/** The shell inspector beside a terminal page: details for the page's own terminal. */
export function TerminalInspector() {
  const { route, navigate } = useScout();
  if (route.view !== "terminal") return null;
  return <TerminalDetails target={route} navigate={navigate} />;
}

/**
 * Who a terminal belongs to, how it is open, and the command that attaches a
 * terminal of your own. The target is route-shaped: the inspector passes the
 * page's route, a Terminal details panel the route its settings describe.
 * Observe and Takeover go through `navigate` to that terminal in that mode,
 * unless `modesBeside` says the terminal's own pane already offers them.
 */
export function TerminalDetails({
  target,
  navigate,
  modesBeside = false,
}: {
  target: TerminalRoute;
  navigate: (route: Route) => void;
  modesBeside?: boolean;
}) {
  const { agents } = useScout();
  const registeredTarget = useRegisteredTarget(target);
  // the name and mark the Terminals list gives it
  const identity = useTerminalRowIdentity(registeredTarget);
  const kind = targetKind(target);

  // who: the agent the route names, else the one bound to the session's surface
  const agent = target.agentId
    ? agents.find((candidate) => candidate.id === target.agentId) ?? null
    : registeredTarget
      ? agentForSurface(agents, registeredTarget.session, registeredTarget.surface, resolveAgentTerminalSurface)
      : null;
  const terminalSurface = target.agentId
    ? resolveAgentTerminalSurface(agent)
    : registeredTarget
      ? terminalSurfaceDescriptorFromRegisteredSurface(registeredTarget.surface)
      : null;
  const attachCommand = attachCommandOf(target, registeredTarget, terminalSurface);

  // the route a mode button opens: the agent's terminal, or the session's
  const modeBase: TerminalRoute | null = target.agentId
    ? { view: "terminal", agentId: target.agentId }
    : registeredTarget && kind === "session"
      ? { view: "terminal", terminalSessionId: target.terminalSessionId, terminalSurfaceKey: target.terminalSurfaceKey }
      : null;
  // as the terminal reads its route, and as the index and the session panel mark it
  const mode = terminalMode(target);

  const modeButtons = modeBase && (
    <div className="grid grid-cols-2 gap-1.5">
      {!modesBeside && terminalSurface && (
        <ModeButton active={mode === "observe"} label="Observe" onClick={() => navigate({ ...modeBase, mode: "observe" })} />
      )}
      {!modesBeside && (
        <ModeButton active={mode === "takeover"} label="Take over" onClick={() => navigate({ ...modeBase, mode: "takeover" })} />
      )}
      {agent && (
        <>
          <ModeButton label="Profile" onClick={() => navigate({ view: "agents-v2", agentId: agent.id, tab: "profile" })} />
          <ModeButton label="Trace" onClick={() => navigate({ view: "agents-v2", agentId: agent.id, tab: "observe" })} />
        </>
      )}
    </div>
  );

  if (!agent) {
    return (
      <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-sm frame-scrollbar">
        <Section label="Terminal">
          <Row label="Mode" value={modeLabel(mode)} />
          {target.agentId && <Row label="Agent" value={target.agentId} />}
          {registeredTarget
            ? terminalSummaryDetailRows(registeredTarget).map(([label, value]) => <Row key={label} label={label} value={value} />)
            : (
              <>
                {terminalSurface && <Row label="Backend" value={terminalSurface.backend} />}
                {terminalSurface && <Row label="Session" value={terminalSurface.sessionName} />}
                {kind === "host" && <Row label="Backend" value={target.terminalBackend ?? "pty"} />}
                {kind === "host" && target.terminalSessionName && <Row label="Session" value={target.terminalSessionName} />}
                {kind === "host" && target.terminalAgent && <Row label="Runs" value={target.terminalAgent} />}
              </>
            )}
        </Section>
        {attachCommand && <CommandDisclosure label="Open in your own terminal" command={attachCommand} />}
        {modeButtons}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-sm frame-scrollbar">
      <AgentHeader agent={agent} identity={identity} />

      <Section label="Terminal">
        <Row label="Mode" value={modeLabel(mode)} />
        <Row label="Backend" value={terminalSurface?.backend ?? registeredTarget?.surface.backend ?? "pty"} />
        {(terminalSurface ?? registeredTarget?.surface) && (
          <Row label="Session" value={terminalSurface?.sessionName ?? registeredTarget?.surface.sessionName ?? ""} />
        )}
        {terminalSurface?.paneId && <Row label="Pane" value={terminalSurface.paneId} />}
        <Row label="State" value={agentStateLabel(agent.state)} />
      </Section>

      {attachCommand && <CommandDisclosure label="Open in your own terminal" command={attachCommand} />}

      {modeButtons}

      <Section label="Agent">
        <Row label="Harness" value={agent.harness ?? "-"} />
        <Row label="Transport" value={agent.transport ?? "-"} />
        {agent.role && <Row label="Role" value={formatLabel(agent.role) ?? agent.role} />}
        {agent.handle && <Row label="Handle" value={`@${agent.handle}`} />}
        {agent.updatedAt && <Row label="Updated" value={timeAgo(agent.updatedAt)} />}
      </Section>

      {(agent.project || agent.branch || agent.cwd || agent.projectRoot) && (
        <Section label="Workspace">
          {agent.project && <Row label="Name" value={agent.project} />}
          {agent.branch && <Row label="Branch" value={agent.branch} />}
          {agent.cwd && <Row label="Cwd" value={agent.cwd} />}
          {!agent.cwd && agent.projectRoot && <Row label="Root" value={agent.projectRoot} />}
        </Section>
      )}
    </div>
  );
}

/**
 * The registered or discovered session a route names, read when the target
 * changes and every 15s while visible, so its condition stays current. Null
 * for an agent route, a host terminal, or a session the host no longer lists.
 */
function useRegisteredTarget(target: TerminalRoute): RegisteredTerminalTarget | null {
  const wanted = !target.agentId && !target.terminalBackend && Boolean(target.terminalSessionId || target.terminalSurfaceKey);
  const key = wanted ? `${target.terminalSessionId ?? ""}|${target.terminalSurfaceKey ?? ""}` : "";
  const [found, setFound] = useState<{ key: string; target: RegisteredTerminalTarget | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const read = () =>
      fetchTerminalSessions()
        .then((sessions) => {
          if (!cancelled) setFound({ key, target: resolveRegisteredTerminalTarget(sessions, target.terminalSessionId, target.terminalSurfaceKey) });
        })
        .catch(() => {
          // a failed refresh keeps the last good read
          if (!cancelled) setFound((prev) => (prev?.key === key ? prev : { key, target: null }));
        });
    void read();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void read(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // a read for the previous target never shows under this one
  return found?.key === key ? found.target : null;
}

function attachCommandOf(
  target: TerminalRoute,
  registeredTarget: RegisteredTerminalTarget | null,
  terminalSurface: ReturnType<typeof resolveAgentTerminalSurface>,
): string | null {
  if (registeredTarget) return attachCommandForSurface(registeredTarget.surface, terminalSurface);
  if (terminalSurface) return attachCommandFor(terminalSurface);
  // a host terminal opened by name (herdr's "Open terminal") attaches by that name
  if (target.terminalBackend && target.terminalSessionName && isRelayCapableTerminalBackend(target.terminalBackend)) {
    return attachCommandFor({
      backend: target.terminalBackend,
      sessionName: target.terminalSessionName,
      paneId: null,
      socketDir: target.zellijSocketDir ?? null,
    });
  }
  return null;
}

function modeLabel(mode: "observe" | "takeover" | null): string {
  if (!mode) return "Summary";
  return mode === "observe" ? "Read-only observe" : "Interactive takeover";
}

/**
 * The terminal's owner, named as the Terminals list names the terminal and
 * led by its harness mark. No mark is better than a made-up one: a session
 * card has no picture of its own, so it gets no letter tile.
 */
function AgentHeader({ agent, identity }: { agent: Agent; identity: TerminalNavRowModel | null }) {
  const harness = markedHarness(agent.harness);
  const mark: TerminalNavRowMark | null = identity?.mark ?? (harness ? { kind: "harness", harness } : null);
  const title = identity?.title ?? terminalAgentRow(agent).title;
  return (
    <div className="border-b border-[var(--scout-chrome-border-soft)] pb-3">
      <div className="flex items-center gap-2.5">
        {mark && mark.kind !== "shell" && (
          <span className="inline-flex flex-none opacity-70"><TerminalRowMark mark={mark} size={18} /></span>
        )}
        <div className="min-w-0">
          <div className="truncate text-lg leading-snug text-[var(--scout-chrome-ink-strong)]" title={agent.name}>
            {title}
          </div>
          {agent.handle && (
            <div className="s-term-right-handle truncate font-mono text-xs text-cyan-400/70">
              @{agent.handle}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  label,
  onClick,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`s-term-right-mode h-7 rounded border px-2 text-xs transition-colors ${
        active
          ? "is-active border-cyan-400/35 bg-cyan-400/[0.12] text-cyan-200"
          : "border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)] text-[var(--scout-chrome-ink-soft)] hover:bg-[var(--scout-chrome-active)] hover:text-[var(--scout-chrome-ink)]"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * The raw multiplexer invocation, behind a disclosure.
 *
 * It used to lead the inspector under the label "Attach command", which taught
 * every operator that Scout is a tmux wrapper. Scout manages the multiplexer;
 * the argv is an escape hatch for the operator who wants their own terminal,
 * and it is labelled by what it does rather than by which tool it drives.
 */
function CommandDisclosure({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details className="s-term-right-command rounded border border-[var(--scout-chrome-border-soft)] bg-[var(--scout-chrome-hover)] p-2">
      <summary className="s-term-right-label cursor-pointer select-none text-xs text-[var(--scout-chrome-ink-faint)]">
        {label}
      </summary>
      <div className="mb-1.5 mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          className="s-term-right-copy rounded border border-cyan-400/20 bg-cyan-400/[0.08] px-2 py-1 text-xs text-cyan-100/80 hover:bg-cyan-400/[0.14]"
          onClick={() => {
            void copyTextToClipboard(command).then((ok) => {
              if (!ok) return;
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <code className="s-term-right-argv block select-text break-all rounded bg-black/25 p-2 font-mono text-xs leading-relaxed text-[var(--scout-chrome-ink)]">
        {command}
      </code>
    </details>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="s-term-right-label mb-1.5 text-xs font-medium text-[var(--scout-chrome-ink-faint)]">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="shrink-0 text-xs text-[var(--scout-chrome-ink-faint)]">
        {label}
      </span>
      <span className="truncate text-right text-xs font-mono text-[var(--scout-chrome-ink)]">
        {value}
      </span>
    </div>
  );
}
