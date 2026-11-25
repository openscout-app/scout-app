import { useMemo } from "react";

import { isStrReplaceTool, laneDisplayPath } from "../../lib/lane-edit-display.ts";
import { buildLaneAskDisplay } from "../../lib/lane-ask-display.ts";
import {
  buildLaneToolDetailModel,
  fmtLaneSessionOffset,
  laneToolCommandLine,
  laneToolOutputText,
  type LaneToolDetailSection,
} from "../../lib/lane-tool-detail.ts";
import type { ObserveEvent } from "../../lib/types.ts";

const PRIMARY_SECTIONS = new Set(["detail", "output", "result", "diff", "change"]);

/** Sections the opened row already prints: the call, its output, its diff and a failed outcome. */
const ROW_SECTIONS = new Set(["output", "result", "diff", "change"]);

function flat(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/gu, " ").replace(/…$/u, "").trim();
}

/** What the inline step adds under its row: only text the row does not already show. */
export function laneInlineStepSections(
  event: ObserveEvent,
  sections: readonly LaneToolDetailSection[],
): LaneToolDetailSection[] {
  const shown = [event.arg, laneToolCommandLine(event), ...(event.stream ?? [])]
    .map(flat)
    .filter((part) => part.length > 0);
  return sections.filter((section) => {
    if (ROW_SECTIONS.has(section.title)) return false;
    if (section.title !== "trace") return true;
    // The raw tail line (`res: …`, `cmd -> res: …`) restates the row.
    const text = flat(section.content);
    return !shown.some((part) => text.includes(part) || part.includes(text));
  });
}

function laneStepOffsetLabel(t: number): string {
  const offset = fmtLaneSessionOffset(t);
  return offset === "at start" ? "first step in the trace" : `${offset} from trace start`;
}

/** The facts line under an opened step: when it ran, where in the trace, and Copy. */
function LaneTraceStepFacts({
  event,
  wallLabel,
  wallTitle,
  extra,
  copyText,
  copyLabel,
}: {
  event: ObserveEvent;
  wallLabel?: string;
  wallTitle?: string;
  extra?: readonly { label: string; value: string }[];
  copyText: string;
  copyLabel: string;
}) {
  return (
    <div className="s-lane-trace-step-facts">
      {wallLabel ? <span className="s-lane-trace-step-fact s-lane-trace-step-fact--lead">{wallLabel}</span> : null}
      {wallTitle ? <span className="s-lane-trace-step-fact">{wallTitle}</span> : null}
      <span className="s-lane-trace-step-fact">{laneStepOffsetLabel(event.t)}</span>
      {extra?.map((field) => (
        <span key={`${field.label}:${field.value}`} className="s-lane-trace-step-fact">
          {field.label} {field.value}
        </span>
      ))}
      <span className="s-lane-trace-step-spacer" aria-hidden />
      <CopyButton text={copyText} label={copyLabel} />
    </div>
  );
}

function LaneTraceStepSections({
  sections,
  partner = false,
}: {
  sections: readonly LaneToolDetailSection[];
  /** The other row's half: shown only while that row is not in the trace. */
  partner?: boolean;
}) {
  if (sections.length === 0) return null;
  return (
    <>
      {sections.map((section) => (
        <div
          key={section.title}
          className={`s-lane-trace-step-section${partner ? " s-lane-trace-step-section--partner" : ""}`}
        >
          <div className="s-lane-trace-step-section-title">{section.title}</div>
          <pre className="s-lane-trace-step-section-body">{section.content}</pre>
        </div>
      ))}
    </>
  );
}

function CopyButton({
  text,
  label,
}: {
  text: string;
  label: string;
}) {
  return (
    <button
      type="button"
      className="s-lane-trace-focus-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
      }}
      title={label}
      aria-label={label}
    >
      Copy
    </button>
  );
}

export type LaneTraceStepPartner = {
  /** The call an opened output row belongs to. */
  call?: ObserveEvent;
  /** The output row of an opened call, written apart from it. */
  output?: ObserveEvent;
};

export function LaneTraceEventFocus({
  event,
  wallLabel,
  wallTitle,
  variant = "sheet",
  partner,
}: {
  event: ObserveEvent;
  wallLabel?: string;
  wallTitle?: string;
  /** `inline` renders attached to the highlighted timeline row. */
  variant?: "sheet" | "inline";
  /** Inline: the other half of a call the tail wrote on two rows. */
  partner?: LaneTraceStepPartner;
}) {
  if (event.kind === "ask") {
    return (
      <LaneTraceAskFocus
        event={event}
        wallLabel={wallLabel}
        wallTitle={wallTitle}
        variant={variant}
      />
    );
  }

  return (
    <LaneTraceToolFocus
      event={event}
      wallLabel={wallLabel}
      wallTitle={wallTitle}
      variant={variant}
      partner={partner}
    />
  );
}

/** The partner row's half of the opened step: a call's output, or the call an output answers. */
function partnerSections(partner: LaneTraceStepPartner | undefined): LaneToolDetailSection[] {
  if (partner?.output) {
    const text = laneToolOutputText(partner.output);
    return text ? [{ title: "output", content: text }] : [];
  }
  if (partner?.call) {
    return [{ title: "call", content: laneToolCommandLine(partner.call) }];
  }
  return [];
}

function partnerOutcome(partner: LaneTraceStepPartner | undefined): { label: string; value: string }[] {
  const outcome = partner?.output?.result?.outcome;
  if (outcome == null) return [];
  const value = String(outcome).trim();
  return value && value !== "success" ? [{ label: "outcome", value }] : [];
}

function LaneTraceToolFocus({
  event,
  wallLabel,
  wallTitle,
  variant,
  partner,
}: {
  event: ObserveEvent;
  wallLabel?: string;
  wallTitle?: string;
  variant: "sheet" | "inline";
  partner?: LaneTraceStepPartner;
}) {
  const model = useMemo(
    () => buildLaneToolDetailModel(event, {
      wallLabel,
      wallTitle,
      sessionOffset: `${fmtLaneSessionOffset(event.t)} from start`,
    }),
    [event, wallLabel, wallTitle],
  );

  const { primarySection, secondarySections } = useMemo(() => {
    if (!model) {
      return { primarySection: null, secondarySections: [] };
    }
    const primary = model.sections.find((section) => PRIMARY_SECTIONS.has(section.title))
      ?? model.sections[0]
      ?? null;
    const secondary = primary
      ? model.sections.filter((section) => section !== primary)
      : model.sections;
    return { primarySection: primary, secondarySections: secondary };
  }, [model]);

  if (!model) return null;

  if (variant === "inline") {
    const paired = partnerSections(partner);
    const copyText = paired.length > 0
      ? [model.copyText, ...paired.map((section) => `${section.title}:\n${section.content}`)].join("\n\n")
      : model.copyText;
    return (
      <section className="s-lane-trace-step" aria-label="Step detail">
        <LaneTraceStepFacts
          event={event}
          wallLabel={wallLabel}
          wallTitle={wallTitle}
          extra={partnerOutcome(partner)}
          copyText={copyText}
          copyLabel="Copy step"
        />
        <LaneTraceStepSections sections={paired} partner />
        <LaneTraceStepSections sections={laneInlineStepSections(event, model.sections)} />
      </section>
    );
  }

  return (
    <section className="s-lane-trace-focus" aria-label="Selected trace event">
      <div className="s-lane-trace-focus-eyebrow">
        <span className="s-lane-trace-focus-eyebrow-dot" aria-hidden />
        Selected command
      </div>

      <div className="s-lane-trace-focus-head">
        <div className="s-lane-trace-focus-head-copy">
          <div className="s-lane-trace-focus-cmd">{model.command}</div>
          {isStrReplaceTool(event.tool) && event.arg?.trim() && (() => {
            const full = laneDisplayPath(event.arg.trim());
            const base = full.split("/").pop() ?? full;
            if (full === base) return null;
            return (
              <div className="s-lane-trace-focus-path" title={event.arg.trim()}>
                {full}
              </div>
            );
          })()}
        </div>
        <CopyButton text={model.copyText} label="Copy event detail" />
      </div>

      {model.hoverFields.length > 0 && (
        <dl className="s-lane-trace-focus-meta">
          {model.hoverFields.map((field) => (
            <div key={field.label} className="s-lane-trace-focus-meta-row">
              <dt>{field.label}</dt>
              <dd title={field.value}>{field.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {primarySection && (
        <div className="s-lane-trace-focus-section s-lane-trace-focus-section--primary">
          <div className="s-lane-trace-focus-section-title">{primarySection.title}</div>
          <pre className="s-lane-trace-focus-section-body">{primarySection.content}</pre>
        </div>
      )}

      {secondarySections.map((section) => (
        <div key={section.title} className="s-lane-trace-focus-section">
          <div className="s-lane-trace-focus-section-title">{section.title}</div>
          <pre className="s-lane-trace-focus-section-body">{section.content}</pre>
        </div>
      ))}
    </section>
  );
}

function LaneTraceAskFocus({
  event,
  wallLabel,
  wallTitle,
  variant,
}: {
  event: ObserveEvent;
  wallLabel?: string;
  wallTitle?: string;
  variant: "sheet" | "inline";
}) {
  const ask = useMemo(() => buildLaneAskDisplay(event), [event]);
  const fields = useMemo(() => {
    const rows = [...ask.fields];
    if (wallLabel) {
      rows.unshift({
        label: "when",
        value: wallTitle ? `${wallLabel} · ${wallTitle}` : wallLabel,
      });
    }
    rows.push({ label: "offset", value: `${fmtLaneSessionOffset(event.t)} from start` });
    return rows;
  }, [ask.fields, event.t, wallLabel, wallTitle]);

  const showRequestPreview = ask.preview && ask.preview !== ask.fullText;
  const showRequestText = ask.requestText
    && ask.requestText !== ask.fullText
    && ask.requestText !== ask.preview;

  if (variant === "inline") {
    // The row prints the title, the preview and the answer; the full request
    // comes here only when the preview was cut.
    const clipped = flat(ask.fullText).length > flat(ask.preview).length;
    return (
      <section className="s-lane-trace-step" aria-label="Request detail">
        <LaneTraceStepFacts
          event={event}
          wallLabel={wallLabel}
          wallTitle={wallTitle}
          extra={ask.fields}
          copyText={ask.copyText}
          copyLabel="Copy full request"
        />
        <LaneTraceStepSections
          sections={clipped ? [{ title: "full request", content: ask.fullText }] : []}
        />
      </section>
    );
  }

  return (
    <section className="s-lane-trace-focus s-lane-trace-focus--ask" aria-label="Selected request">
      <div className="s-lane-trace-focus-eyebrow">
        <span className="s-lane-trace-focus-eyebrow-dot" aria-hidden />
        Selected request
      </div>

      <div className="s-lane-trace-focus-head">
        <div className="s-lane-trace-focus-head-copy">
          <div className="s-lane-trace-focus-cmd">{ask.title}</div>
          {showRequestPreview ? (
            <div className="s-lane-trace-focus-ask-preview">{ask.preview}</div>
          ) : null}
        </div>
        <CopyButton text={ask.copyText} label="Copy full request" />
      </div>

      {fields.length > 0 && (
        <dl className="s-lane-trace-focus-meta">
          {fields.map((field) => (
            <div key={`${field.label}:${field.value}`} className="s-lane-trace-focus-meta-row">
              <dt>{field.label}</dt>
              <dd title={field.value}>{field.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="s-lane-trace-focus-section s-lane-trace-focus-section--primary">
        <div className="s-lane-trace-focus-section-title">full request</div>
        <pre className="s-lane-trace-focus-section-body">{ask.fullText}</pre>
      </div>

      {showRequestText ? (
        <div className="s-lane-trace-focus-section">
          <div className="s-lane-trace-focus-section-title">request preview</div>
          <pre className="s-lane-trace-focus-section-body">{ask.requestText}</pre>
        </div>
      ) : null}

      {ask.answer ? (
        <div className="s-lane-trace-focus-section">
          <div className="s-lane-trace-focus-section-title">{ask.answer.label}</div>
          <pre className="s-lane-trace-focus-section-body">{ask.answer.text}</pre>
        </div>
      ) : null}
    </section>
  );
}
