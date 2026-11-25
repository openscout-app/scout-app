import { useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState.tsx";
import { ScoutbotMarkdown } from "../../lib/scoutbot-markdown.tsx";
import { fullTimestamp, timeAgo } from "../../lib/time.ts";
import type { Route } from "../../lib/types.ts";
import {
  briefingRoute,
  deriveSnapshotCounts,
  elapsedLabel,
  hasTelemetry,
  kindLabel,
  observationTone,
  presenterNote,
  referenceLabel,
  TONE_LABEL,
  type BriefBody,
  type BriefingDetail,
  type CallBody,
  type CallTelemetry,
  type ObservationItem,
  type PresentedBody,
  type ReferenceItem,
  type SnapshotBody,
} from "./briefings-model.ts";
import { useBriefingDetail } from "./use-briefings.ts";
import { BriefingSlides } from "./BriefingSlides.tsx";
import "../system-surfaces-redesign.css";
import "./briefings.css";

type Navigate = (r: Route) => void;

/**
 * One briefing as a full page. The web app draws /briefings/:id as the
 * Briefings view, whose Briefing panel (screens/views/modules/briefing.tsx)
 * draws the same body; this page stays for anything that mounts
 * BriefingsContent.
 */
export function BriefingDetailScreen({
  briefingId,
  navigate,
}: {
  briefingId: string;
  navigate: Navigate;
}) {
  // the shared read: every Briefing panel on this id reads the same one
  const { detail, error, gone } = useBriefingDetail(briefingId);

  if (!detail && (error || gone)) {
    return (
      <div className="sys-surface-page sys-surface-page-wide">
        <button
          type="button"
          className="briefing-detail-back"
          onClick={() => navigate(briefingRoute())}
        >
          ← back to briefings
        </button>
        <EmptyState title="Couldn't load briefing" body={error ?? "not found"} />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="sys-surface-page sys-surface-page-wide">
        <div className="briefings-placeholder">Loading briefing...</div>
      </div>
    );
  }

  return (
    <div className="sys-surface-page sys-surface-page-wide briefing-detail">
      <button
        type="button"
        className="briefing-detail-back"
        onClick={() => navigate(briefingRoute())}
      >
        ← back to briefings
      </button>
      <BriefingBody detail={detail} navigate={navigate} />
    </div>
  );
}

/**
 * The header and work summaries lead; the complete written brief and generation
 * details remain available in disclosures. The page and the Briefing panel
 * draw it alike; `panel` swaps the page's buttons for the panel's chips.
 * Actions and references go where they point, through `navigate`.
 */
export function BriefingBody({
  detail,
  navigate,
  panel = false,
  marker,
}: {
  detail: BriefingDetail;
  navigate: Navigate;
  panel?: boolean;
  /** A word before the kind, for a panel that shows the latest briefing. */
  marker?: string | null;
}) {
  const button = panel ? "vw-chip" : "s-btn";
  return (
    <>
      <header className="briefing-detail-header">
        <h2>{detail.title}</h2>
        <div className="briefing-detail-header-meta">
          {marker ? <span className="briefing-detail-marker">{marker}</span> : null}
          <span className={`briefing-kind briefing-kind-${detail.kind}`}>
            {kindLabel(detail.kind, true)}
          </span>
          <span>{fullTimestamp(detail.preparedAt)}</span>
          <span>· {timeAgo(detail.preparedAt)}</span>
        </div>
      </header>

      <BriefingSlides key={`${detail.id}:${detail.preparedAt}`} detail={detail} navigate={navigate} />

      <details className="briefing-written">
        <summary>Read the full brief</summary>
        <p className="briefing-detail-summary">{detail.summary}</p>
        {detail.recommendation ? (
          <div className="briefing-detail-recommendation">
            {detail.recommendation}
          </div>
        ) : null}

        {detail.markdown ? (
          <MarkdownLayer markdown={detail.markdown} />
        ) : null}
        {detail.brief?.presented ? (
          <PresentedLayer presented={detail.brief.presented} />
        ) : null}
        <BriefLayer brief={detail.brief} navigate={navigate} button={button} />
        <ObservationsLayer observations={detail.observations} navigate={navigate} />
      </details>
      <details className="briefing-written">
        <summary>Generation details</summary>
        <TelemetryLayer call={detail.call} />
        <SnapshotLayer snapshot={detail.snapshot} call={detail.call} toggle={panel ? "vw-chip" : "briefing-detail-back"} />
      </details>
    </>
  );
}

function MarkdownLayer({ markdown }: { markdown: string }) {
  return (
    <section className="briefing-layer briefing-layer-markdown">
      <LayerHead eyebrow="Layer 0" title="Brief (markdown)" />
      <div className="briefing-markdown">
        <ScoutbotMarkdown text={markdown} />
      </div>
    </section>
  );
}

function TelemetryLayer({ call }: { call: CallBody | null }) {
  if (!hasTelemetry(call)) return null;
  return (
    <section className="briefing-layer briefing-layer-telemetry">
      <LayerHead eyebrow="Telemetry" title="Calls & usage" />
      <dl className="briefing-telemetry">
        <CallTelemetryRow
          label="Analyst"
          model={call.model}
          responseId={call.responseId}
          telemetry={call.telemetry ?? null}
        />
        {call.presenter ? (
          <CallTelemetryRow
            label="Presenter"
            model={call.presenter.model}
            responseId={call.presenter.responseId}
            telemetry={call.presenter}
            note={presenterNote(call.presenter)}
          />
        ) : null}
      </dl>
    </section>
  );
}

function CallTelemetryRow({
  label,
  model,
  responseId,
  telemetry,
  note,
}: {
  label: string;
  model: string;
  responseId: string | null;
  telemetry: CallTelemetry | null;
  note?: string | null;
}) {
  const usage = telemetry?.usage ?? null;
  return (
    <div className="briefing-telemetry-row">
      <div className="briefing-telemetry-row-head">
        <span className="briefing-telemetry-label">{label}</span>
        <span className="briefing-telemetry-model">{model}</span>
        {note ? <span className="briefing-telemetry-note">{note}</span> : null}
      </div>
      <div className="briefing-telemetry-stats">
        <span>{elapsedLabel(telemetry)}</span>
        <span>in {usage?.inputTokens ?? "—"}</span>
        <span>out {usage?.outputTokens ?? "—"}</span>
        <span>total {usage?.totalTokens ?? "—"}</span>
        {responseId ? <span className="briefing-telemetry-response">{responseId}</span> : null}
      </div>
    </div>
  );
}

function PresentedLayer({ presented }: { presented: PresentedBody }) {
  return (
    <section className="briefing-layer briefing-layer-presented">
      <LayerHead
        eyebrow="Spoken"
        title={`Presented as · ${presented.voiceSpec.persona}, ~${presented.voiceSpec.targetWords} words`}
      />
      <ol className="briefing-presented-sentences">
        {presented.sentences.map((sentence, idx) => (
          <li key={idx} className="briefing-presented-sentence">
            {sentence}
          </li>
        ))}
      </ol>
      <div className="briefing-presented-meta">
        model: {presented.model}
        {presented.responseId ? ` · response: ${presented.responseId}` : ""}
      </div>
    </section>
  );
}

function BriefLayer({
  brief,
  navigate,
  button,
}: {
  brief: BriefBody | null;
  navigate: Navigate;
  button: string;
}) {
  if (!brief) {
    return (
      <section className="briefing-layer">
        <LayerHead eyebrow="Layer 3" title="Brief & call" />
        <p className="briefings-placeholder">No brief body persisted.</p>
      </section>
    );
  }
  return (
    <section className="briefing-layer">
      <LayerHead eyebrow="Layer 3" title="Brief" />
      {brief.steps.length > 0 ? (
        <ol className="briefing-steps">
          {brief.steps.map((step, idx) => (
            <li key={step.id ?? idx} className="briefing-step">
              <div className="briefing-step-label">
                {idx + 1}. {step.label}
              </div>
              {step.narration ? (
                <p className="briefing-step-narration">{step.narration}</p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {brief.actions.length > 0 ? (
        <div className="briefing-actions">
          {brief.actions.map((action, idx) => (
            <button
              type="button"
              key={`${action.label}-${idx}`}
              className={button}
              onClick={() => {
                if (action.route) navigate(action.route as Route);
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ObservationsLayer({
  observations,
  navigate,
}: {
  observations: ObservationItem[];
  navigate: Navigate;
}) {
  return (
    <section className="briefing-layer">
      <LayerHead
        eyebrow="Layer 2"
        title={`Observations (${observations.length})`}
      />
      {observations.length === 0 ? (
        <p className="briefings-placeholder">No observations on this brief.</p>
      ) : (
        <div className="briefing-observations">
          {observations.map((obs, idx) => {
            const tone = observationTone(obs.tone);
            return (
              <div
                key={idx}
                className={`briefing-observation ${tone ? `briefing-observation-${tone}` : ""}`.trim()}
              >
                <div className="briefing-observation-text">
                  {tone ? <span className="briefing-observation-tone">{TONE_LABEL[tone]}</span> : null}
                  {obs.text}
                </div>
                {obs.references.length > 0 ? (
                  <div className="briefing-observation-refs">
                    {obs.references.map((ref, ridx) => (
                      <ReferenceChip
                        key={`${ref.label}-${ridx}`}
                        reference={ref}
                        navigate={navigate}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ReferenceChip({
  reference,
  navigate,
}: {
  reference: ReferenceItem;
  navigate: Navigate;
}) {
  const label = referenceLabel(reference);
  if (!reference.route) {
    return (
      <span className="briefing-ref-chip briefing-ref-chip-static">{label}</span>
    );
  }
  return (
    <button
      type="button"
      className="briefing-ref-chip"
      onClick={() => navigate(reference.route as Route)}
    >
      {label}
    </button>
  );
}

function SnapshotLayer({
  snapshot,
  call,
  toggle,
}: {
  snapshot: SnapshotBody | null;
  call: CallBody | null;
  toggle: string;
}) {
  const counts = useMemo(() => deriveSnapshotCounts(snapshot), [snapshot]);
  const [showRaw, setShowRaw] = useState(false);

  return (
    <section className="briefing-layer">
      <LayerHead eyebrow="Layer 1" title="Read snapshot" />
      {counts.length > 0 ? (
        <div className="briefing-snapshot-counts">
          {counts.map((c) => (
            <span key={c.label} className="briefing-snapshot-count">
              <strong>{c.value}</strong> {c.label}
            </span>
          ))}
        </div>
      ) : null}
      {call ? (
        <details className="briefing-snapshot-section">
          <summary className="briefing-snapshot-section-head">
            Call metadata
          </summary>
          <dl className="briefing-call-grid">
            <dt>Model</dt>
            <dd>{call.model}</dd>
            <dt>Response ID</dt>
            <dd>{call.responseId ?? "—"}</dd>
            <dt>System prompt</dt>
            <dd>
              <pre className="briefing-call-prompt">{call.systemPrompt}</pre>
            </dd>
            <dt>Operator request</dt>
            <dd>
              <pre className="briefing-call-prompt">{call.operatorRequest}</pre>
            </dd>
          </dl>
        </details>
      ) : null}
      <div className="briefing-snapshot-section">
        <button
          type="button"
          className={toggle}
          aria-expanded={showRaw}
          onClick={() => setShowRaw((v) => !v)}
        >
          {showRaw ? "Hide raw snapshot" : "Show raw snapshot JSON"}
        </button>
        {showRaw ? (
          <pre className="briefing-snapshot-raw">
            {JSON.stringify(snapshot ?? {}, null, 2)}
          </pre>
        ) : null}
      </div>
    </section>
  );
}

function LayerHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="briefing-layer-head">
      <span className="briefing-layer-eyebrow">{eyebrow}</span>
      <span className="briefing-layer-title">{title}</span>
    </div>
  );
}
