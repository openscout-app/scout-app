import { useMemo, useState } from "react";

import { companionHostAvailable } from "../../../lib/companion-host.ts";
import type { AgentRosterImportResult } from "../../../../shared/api/roster.ts";
import {
  displayCode,
  importEntriesOf,
  importPreview,
  localLabel,
  markLocalRosterImported,
  readLocalRoster,
  type ImportPreview,
  type LocalRosterImported,
} from "./local-roster.ts";
import { importToRuntime } from "./runtime-roster.ts";

/*
 * Moving this page's old numbers to the runtime, once (agent-roster.md,
 * "Import from the apps"). Browser storage is per origin and per app, so the
 * numbers the operator knows are in the storage of the surface that drew
 * them: open the board's settings there. The page says whose storage it is
 * and how many numbers it holds; the operator checks with the runtime (a dry
 * run that writes nothing), reads what would change and what conflicts, and
 * only then imports. Nothing here runs on load.
 */

type Step =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "checked"; result: AgentRosterImportResult }
  | { kind: "importing"; result: AgentRosterImportResult }
  | { kind: "imported"; result: AgentRosterImportResult }
  | { kind: "failed"; message: string; after: AgentRosterImportResult | null };

/** Whose storage this page reads: Scout.app's web view, or a browser at this address. */
export function storageName(hostApp = companionHostAvailable(), where = typeof window === "undefined" ? "" : window.location.host): string {
  return hostApp ? `Scout.app on this host (${where})` : `this browser at ${where}`;
}

function when(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The runtime's answer, one hairline row per number: the label the board drew, who it is, and what the runtime keeps. */
function PreviewList({ preview, nameOf, done }: { preview: ImportPreview; nameOf: (agentId: string) => string | null; done: boolean }) {
  return (
    <div className="arv-imp__list">
      <p className="arv-imp__sum">
        {done ? "Imported. " : "Dry run: nothing is written yet. "}
        {done ? "The runtime keeps" : "The runtime would keep"} {preview.kept} of {plural(preview.rows.length, "number")}
        {preview.moved.length > 0 && <>, {done ? "moved" : "would move"} {plural(preview.moved.length, "agent")} it numbered itself</>}
        {preview.projectCodes.length > 0 && <>, and {done ? "set" : "would set"} {plural(preview.projectCodes.length, "project code")}</>}.
      </p>
      <ul>
        {preview.rows.map((row) => (
          <li key={row.entry.key} className={row.code ? undefined : "is-refused"}>
            <span className="arv-imp__was">{localLabel(row.entry)}</span>
            <span className="arv-imp__who" title={row.entry.key}>{nameOf(row.entry.key) ?? row.entry.key}{row.entry.project ? <i> · {row.entry.project}</i> : null}</span>
            <span className="arv-imp__then">{row.code ? displayCode(row.code) : row.numberRefused}</span>
            {row.codeRefused && <small className="arv-imp__note">Code not taken: {row.codeRefused}</small>}
          </li>
        ))}
      </ul>
      {preview.moved.length > 0 && (
        <>
          <h5>{done ? "Moved aside" : "Would move aside"}</h5>
          <ul>
            {preview.moved.map((m) => (
              <li key={m.agentId}>
                <span className="arv-imp__was">{String(m.from).padStart(3, "0")}</span>
                <span className="arv-imp__who" title={m.agentId}>{nameOf(m.agentId) ?? m.agentId}</span>
                <span className="arv-imp__then">{m.to === null ? "No number free" : String(m.to).padStart(3, "0")}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {preview.projectCodes.length > 0 && (
        <>
          <h5>{done ? "Project codes set" : "Project codes it would set"}</h5>
          <ul>
            {preview.projectCodes.map((p) => (
              <li key={p.projectKey}>
                <span className="arv-imp__was">{p.code}</span>
                <span className="arv-imp__who">{p.projectKey}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {preview.skipped.length > 0 && (
        <p className="arv-imp__sum">
          {plural(preview.skipped.length, "number")} {preview.skipped.length === 1 ? "is" : "are"} not sent: {preview.skipped.length === 1 ? "it names" : "they name"} native sessions or figures the runtime does not list as agents.
        </p>
      )}
    </div>
  );
}

/**
 * The import's row in the board's settings: one line and its two actions. Nothing when this page holds no old
 * numbers, or once they are imported (the CLI's `scout roster import` can check them again).
 */
export function RosterImport({ nameOf, onImported }: {
  /** An agent's name as the board knows it, for the rows. */
  nameOf: (agentId: string) => string | null;
  /** After a real import: read the runtime's roster again. */
  onImported: () => void;
}) {
  const local = useMemo(readLocalRoster, []);
  const [imported, setImported] = useState<LocalRosterImported | null>(local.imported);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const { entries } = useMemo(() => importEntriesOf(local.roster), [local.roster]);
  const count = local.roster.entries.length;
  // A finished import is done: the row goes, unless this visit is the one that just ran it.
  if (count === 0 || (imported && step.kind === "idle")) return null;

  const check = () => {
    setStep({ kind: "checking" });
    importToRuntime(entries, true)
      .then((result) => setStep({ kind: "checked", result }))
      .catch((error: Error) => setStep({ kind: "failed", message: error.message, after: null }));
  };
  const confirm = (checked: AgentRosterImportResult) => {
    setStep({ kind: "importing", result: checked });
    importToRuntime(entries, false)
      .then((result) => {
        setImported(markLocalRosterImported(result.imported.length));
        setStep({ kind: "imported", result });
        onImported();
      })
      .catch((error: Error) => setStep({ kind: "failed", message: error.message, after: checked }));
  };
  const copy = () => {
    const text = `${JSON.stringify({ entries }, null, 2)}\n`;
    void (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error("no clipboard")))
      .then(() => setCopied("copied"), () => setCopied("failed"));
  };

  const busy = step.kind === "checking" || step.kind === "importing";
  const shown = step.kind === "checked" || step.kind === "importing" || step.kind === "imported" ? step.result : step.kind === "failed" ? step.after : null;
  const preview = shown ? importPreview(local.roster, shown) : null;
  const note = imported && step.kind !== "imported"
    ? `Imported ${plural(imported.imported, "number")} on ${when(imported.at)}.`
    : `${plural(count, "number")} given out here before the runtime kept the roster.`;

  return (
    <>
      <div className="arv-set__row">
        <span className="arv-set__key" title={`Stored in ${storageName()}`}>Numbers from before<small>{note}</small></span>
        {(step.kind === "idle" || step.kind === "failed" || step.kind === "imported") && (
          <span className="arv-imp__acts">
            <button type="button" className="arv-set__btn" onClick={check}>{step.kind === "idle" && !imported ? "Check" : "Check again"}</button>
            <button type="button" className="arv-imp__link" onClick={copy} title="The scout roster import file, for a terminal on this host">
              {copied === "copied" ? "Copied" : copied === "failed" ? "Could not copy" : "Copy as file"}
            </button>
          </span>
        )}
        {busy && <span className="arv-imp__busy">{step.kind === "checking" ? "Checking…" : "Importing…"}</span>}
      </div>
      {step.kind === "failed" && <p className="arv-set__note arv-imp__failed">{step.message}</p>}
      {preview && (
        <div className="arv-imp">
          <PreviewList preview={preview} nameOf={nameOf} done={step.kind === "imported"} />
          {(step.kind === "checked" || step.kind === "importing") && (
            <div className="arv-imp__acts is-confirm">
              <button type="button" className="arv-set__btn" disabled={busy || preview.kept === 0} onClick={() => confirm(step.result)}>
                {preview.kept === 0 ? "Nothing to import" : `Import ${plural(preview.kept, "number")}`}
              </button>
              <button type="button" className="arv-imp__link" disabled={busy} onClick={() => setStep({ kind: "idle" })}>Cancel</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
