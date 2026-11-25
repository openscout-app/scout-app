/**
 * Plan — a plan document found on disk, read in place: the plan Host Advisor's ?plan= names.
 *
 * Shows:  with a plan chosen: its title, status, where it lives and its
 *         steps done, its summary, then the document (Preview renders the
 *         Markdown, Source shows the file as written), then where it came
 *         from (source, file, workspace, agent, tags) and when it changed.
 *         With none: every plan found, newest first, each with its status,
 *         workspace, agent and steps. A plan the index no longer finds says
 *         so, with the way back.
 * Data:   GET /api/plan-documents (it indexes the workspaces and home plan
 *         folders on each read), on open and every 60s while the view is
 *         visible; one read shared by every Plan panel and its picker.
 *         Refresh in the head reads again.
 * Scope:  Plan: "This page's plan" (@route) follows ?plan= on Ops › Host
 *         Advisor (/ops/advisor?plan=…, and the legacy /ops/plan); off that
 *         page it shows the list. Or one plan, kept with the panel. "" = the
 *         list.
 * Opens:  a plan in the list: on Ops › Host Advisor following the page, the
 *         page's ?plan= (Back returns to the list); anywhere else the panel
 *         keeps it. The file: the file preview. All plans: back to the list.
 */
import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import "../../../components/document-focus-viewer.css";
import { createTextDocument, TextDocumentSurface } from "../../../components/TextDocumentSurface.tsx";
import { api } from "../../../lib/api.ts";
import { timeAgo } from "../../../lib/time.ts";
import type { PlanDocument, PlanDocumentsResponse } from "../../../lib/types.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { defineModule, type ModuleProps, type ModuleScope } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import {
  leavePlan,
  pickPlan,
  planChoice,
  planList,
  planMeta,
  planOptions,
  planProvenance,
  PLAN_STATUS_LABEL,
  stepTally,
} from "./plan-document-model.ts";
import { Quiet } from "./shared.tsx";
import "./plan-document.css";

/* ── one read for every Plan panel ── */

type PlanRead = { documents: PlanDocument[] | null; error: string | null; reading: boolean; at: number };

const EVERY_MS = 60_000;
let plans: PlanRead = { documents: null, error: null, reading: false, at: 0 };
let inFlight: Promise<void> | null = null;
let readers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
const set = (next: PlanRead) => {
  plans = next;
  for (const listener of [...listeners]) listener();
};

function readPlans(): Promise<void> {
  if (inFlight) return inFlight;
  set({ ...plans, reading: true });
  inFlight = api<PlanDocumentsResponse>("/api/plan-documents")
    .then(
      (res) => set({ documents: res.documents ?? [], error: null, reading: false, at: Date.now() }),
      (e: unknown) => set({ ...plans, error: e instanceof Error ? e.message : String(e), reading: false }),
    )
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function usePlans(): PlanRead {
  useEffect(() => {
    readers++;
    if (Date.now() - plans.at > EVERY_MS / 2) void readPlans();
    if (readers === 1) timer = setInterval(() => document.visibilityState === "visible" && void readPlans(), EVERY_MS);
    return () => {
      readers--;
      if (readers === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => plans,
    () => plans,
  );
}

const planScope: ModuleScope = {
  key: "plan",
  allLabel: "All plans",
  followsPage: "This page's plan",
  useOptions: () => {
    const { documents } = usePlans();
    return useMemo(() => planOptions(documents ?? []), [documents]);
  },
};

/* ── the panel ── */

function Plan({ route, navigate, config, setConfig }: ModuleProps) {
  const { documents, error, reading } = usePlans();
  const chosen = planChoice(config, route);
  const go = (to: { navigate: typeof route } | { config: Record<string, string> }) =>
    "navigate" in to ? navigate(to.navigate) : setConfig(to.config);

  const head = (
    <ModuleHead>
      {chosen && (
        <button type="button" className="vw-chip" onClick={() => go(leavePlan(config, route))} title="Every plan found">
          All plans
        </button>
      )}
      <button type="button" className="vw-chip" disabled={reading} onClick={() => void readPlans()} title="Look for plans again">
        <RefreshCw size={10} /> {reading ? "Reading..." : "Refresh"}
      </button>
    </ModuleHead>
  );

  if (!documents) return <>{head}<Quiet>{error ? "Couldn't read the plans." : "Looking for plans…"}</Quiet></>;

  if (chosen) {
    const plan = documents.find((doc) => doc.id === chosen);
    return (
      <>
        {head}
        {plan ? (
          <PlanView plan={plan} />
        ) : (
          <div className="vw-plan-missing">
            <Quiet>This plan is no longer where it was found.</Quiet>
            <button type="button" className="vw-chip" onClick={() => go(leavePlan(config, route))}>All plans</button>
          </div>
        )}
      </>
    );
  }

  const list = planList(documents);
  return (
    <>
      {head}
      {list.length === 0 ? (
        <Quiet>No plans found in the workspaces or the home plan folders.</Quiet>
      ) : (
        <ul className="vw-rows vw-plan-list">
          {list.map((plan) => (
            <li key={plan.id}>
              <button type="button" className="vw-row vw-row--plan" onClick={() => go(pickPlan(config, route, plan.id))}>
                <span className="vw-strong vw-ell">{plan.title}</span>
                <span className={`vw-plan-status${plan.status === "active" ? " is-active" : ""}`}>{PLAN_STATUS_LABEL[plan.status]}</span>
                <span className="vw-dim vw-ell">{planMeta(plan)}</span>
                <span className="vw-dim vw-num">{timeAgo(plan.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PlanView({ plan }: { plan: PlanDocument }) {
  const { openFilePreview } = useScout();
  const [mode, setMode] = useState<"preview" | "read">("preview");
  // Preview renders the plan's body; Source shows the file as written (front matter and all)
  const doc = useMemo(
    () =>
      createTextDocument({
        id: plan.id,
        title: plan.title,
        filename: plan.path,
        uri: plan.path,
        value: mode === "preview" ? plan.body || plan.rawText : plan.rawText || plan.body,
        readOnly: true,
      }),
    [mode, plan.id, plan.title, plan.path, plan.rawText, plan.body],
  );
  const tally = stepTally(plan);
  const markdown = doc.kind === "markdown";
  return (
    <article className="vw-plan">
      <header className="vw-plan-head">
        <div className="vw-plan-title">
          <h3>{plan.title}</h3>
          <span className={`vw-plan-status${plan.status === "active" ? " is-active" : ""}`}>{PLAN_STATUS_LABEL[plan.status]}</span>
        </div>
        <div className="vw-plan-meta vw-dim">
          {[plan.workspaceName, plan.agentName, tally ? `${tally.done}/${tally.total} steps` : null, `changed ${timeAgo(plan.updatedAt)}`]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {plan.summary && <p className="vw-plan-summary">{plan.summary}</p>}
        {markdown && (
          <div className="vw-plan-modes" role="group" aria-label="Show as">
            <button type="button" className="vw-chip" aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>
              Preview
            </button>
            <button type="button" className="vw-chip" aria-pressed={mode === "read"} onClick={() => setMode("read")}>
              Source
            </button>
          </div>
        )}
      </header>
      <TextDocumentSurface document={doc} mode={markdown ? mode : "read"} className="vw-plan-body" />
      <dl className="vw-plan-prov">
        {planProvenance(plan).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {label === "File" ? (
                <button type="button" className="vw-plan-file" onClick={() => openFilePreview(value)} title="Open the file">
                  {plan.provenance.relativePath || value}
                </button>
              ) : (
                value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export const planDocumentModule = defineModule({
  type: "plan",
  title: "Plan",
  blurb: "A plan document found on disk, read in place; follows Ops › In flight's ?plan=",
  docs: {
    shows: "A plan's title, status, steps and summary, the document (Preview or Source) and where it came from. With none chosen: every plan found, newest first.",
    data: "GET /api/plan-documents on open and every 60s while visible, shared by every Plan panel; Refresh in the head.",
    opens: "A plan from the list (the page's ?plan= on Ops › In flight, else the panel's own); the file's preview; All plans.",
  },
  size: { w: 5, h: 14 },
  minSize: { w: 3, h: 6 },
  scopes: [planScope],
  Component: Plan,
});
