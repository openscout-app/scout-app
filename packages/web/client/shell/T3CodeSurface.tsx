import { useCallback, useEffect, useState } from "react";
import { CONNECTED_TOOLS } from "./surface-catalog.ts";
import { parseT3CodeStatus, T3CODE_CONNECT_COMMAND, type T3CodeStatus } from "./t3code.ts";

const tool = CONNECTED_TOOLS.find(t => t.id === "t3code")!;

/**
 * Permissions for the operator's own T3 Code page. Its origin is a different
 * loopback port from Scout App's, so it stays cross-origin to this document
 * and cannot reach the Scout page around it.
 */
const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";

export type T3CodeViewState = "checking" | "setup" | "offline" | "blocked" | "frame";

export function t3CodeViewState(status: T3CodeStatus | null): T3CodeViewState {
  if (!status) return "checking";
  if (!status.configured) return "setup";
  if (!status.reachable) return "offline";
  return status.frameBlocked ? "blocked" : "frame";
}

/** Asks the host whether T3 Code is configured, answers, and allows framing. */
export function T3CodeSurface({ configuredUrl = null }: { configuredUrl?: string | null }) {
  const [status, setStatus] = useState<T3CodeStatus | null>(null);
  const check = useCallback(async (signal?: AbortSignal) => {
    setStatus(null);
    try {
      const res = await fetch("/api/t3code", { cache: "no-store", signal });
      const body = res.ok ? await res.json().catch(() => null) : (await res.body?.cancel(), null);
      if (signal?.aborted) return;
      const parsed = parseT3CodeStatus(body);
      setStatus(parsed.configured || !configuredUrl ? parsed : { configured: true, url: configuredUrl, reachable: false });
    } catch {
      if (signal?.aborted) return;
      setStatus(configuredUrl ? { configured: true, url: configuredUrl, reachable: false } : { configured: false });
    }
  }, [configuredUrl]);
  useEffect(() => {
    const controller = new AbortController();
    void check(controller.signal);
    return () => controller.abort();
  }, [check]);
  return <T3CodeView status={status} configuredUrl={configuredUrl} onCheck={() => void check()} />;
}

const connection: Record<T3CodeViewState, { status: string; label: string }> = {
  checking: { status: "connecting", label: "Checking" },
  setup: { status: "idle", label: "Not connected" },
  offline: { status: "unreachable", label: "Not answering" },
  blocked: { status: "connected", label: "Running" },
  frame: { status: "connected", label: "Connected" },
};

/** The T3 Code page for one known status. `null` means the check is still running. */
export function T3CodeView({ status, configuredUrl = null, onCheck }: {
  status: T3CodeStatus | null;
  configuredUrl?: string | null;
  onCheck?: () => void;
}) {
  const state = t3CodeViewState(status);
  const url = status?.configured ? status.url : configuredUrl;
  const { status: dot, label } = connection[state];
  return (
    <section className="app-t3" data-state={state} aria-labelledby="app-t3-name">
      <header className="app-t3Strip">
        <span className="app-t3Name" id="app-t3-name">T3 Code</span>
        <span className="app-t3Conn" data-status={dot} role="status"><span className="app-runtimeDot" aria-hidden="true" />{label}</span>
        {url ? <span className="app-t3Origin" title="Loopback address of your T3 Code server">{url.replace(/^http:\/\//, "")}</span> : null}
        <span className="app-t3Spacer" />
        <a className="app-t3Credit" href={tool.project.href} target="_blank" rel="noopener noreferrer" title="T3 Code source and license">
          {tool.project.name} · {tool.project.license}
        </a>
        {url ? <a className="app-t3Open" href={url} target="_blank" rel="noopener noreferrer">Open in T3 Code ↗</a> : null}
      </header>
      {state === "frame" ? (
        <iframe
          className="app-t3Frame"
          src={url + "/"}
          title="T3 Code"
          sandbox={SANDBOX}
          allow="clipboard-read; clipboard-write"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="app-t3Body">
          {state === "checking" ? <p className="app-t3Checking">Checking for T3 Code on this machine…</p> : null}
          {state === "blocked" && status?.configured && status.reachable && status.frameBlocked ? (
            <Blocked url={status.url} by={status.blockedBy} />
          ) : null}
          {state === "offline" && url ? <Offline url={url} onCheck={onCheck} /> : null}
          {state === "setup" ? <Setup /> : null}
        </div>
      )}
    </section>
  );
}

function Blocked({ url, by }: { url: string; by: "x-frame-options" | "frame-ancestors" }) {
  return (
    <section className="app-empty" aria-labelledby="app-t3-blocked">
      <h2 id="app-t3-blocked">T3 Code is running, and it does not allow embedding.</h2>
      <p>
        Your T3 Code server at <code>{url}</code> answers, but its{" "}
        {by === "x-frame-options" ? <code>X-Frame-Options</code> : <>Content Security Policy (<code>frame-ancestors</code>)</>}{" "}
        header tells browsers not to show it inside another page. Scout App respects that and does not work around it.
      </p>
      <p><a className="app-button" href={url} target="_blank" rel="noopener noreferrer">Open T3 Code in browser ↗</a></p>
    </section>
  );
}

function Offline({ url, onCheck }: { url: string; onCheck?: () => void }) {
  return (
    <section className="app-empty" aria-labelledby="app-t3-offline">
      <h2 id="app-t3-offline">T3 Code is not answering.</h2>
      <p>Scout App is set to open T3 Code at <code>{url}</code>, but nothing answered there. Start T3 Code on this machine, then check again.</p>
      <p className="app-t3Actions">
        <button type="button" className="app-button" onClick={onCheck}>Check again</button>
        <a className="app-t3Link" href={tool.project.href} target="_blank" rel="noopener noreferrer">How to run T3 Code ↗</a>
      </p>
    </section>
  );
}

function Setup() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(T3CODE_CONNECT_COMMAND).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }, () => {});
  };
  return (
    <section className="app-empty" aria-labelledby="app-t3-setup">
      <h2 id="app-t3-setup">Connect T3 Code</h2>
      <p>
        <a href={tool.project.href} target="_blank" rel="noopener noreferrer">T3 Code</a> is a separate, MIT-licensed app for
        working with coding agents, made by the <code>{tool.project.name}</code> project. You run it on your own machine.
      </p>
      <p>
        Scout App opens your T3 Code server over loopback, as is, inside this page. It does not bundle or change T3 Code,
        and it never sends tokens to it. Start this preview with the address your T3 Code server prints:
      </p>
      <div className="app-command">
        <code>{T3CODE_CONNECT_COMMAND}</code>
        <button type="button" onClick={copy} aria-live="polite">{copied ? "Copied" : "Copy"}</button>
      </div>
      <p className="app-emptyNext">
        Only <code>http://127.0.0.1</code>, <code>http://localhost</code> and <code>http://[::1]</code> addresses are accepted.
        If your Scout runtime already lists T3 Code in <code>OPENSCOUT_T3_CONNECTIONS</code>, Scout App reads the address from
        there and ignores the rest of the entry.
      </p>
    </section>
  );
}
