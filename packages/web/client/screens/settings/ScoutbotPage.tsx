/**
 * Settings › Scoutbot.
 *
 * What Scoutbot uses comes first: tokens by day and by window, every occasion
 * it asks a model for something, what a request carries, and the requests
 * themselves. Then what it runs on and what it is told.
 *
 * Every figure is read from the usage store or measured from the state a turn
 * would send. Where a provider reported no tokens the page says so; it never
 * estimates.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { api } from "../../lib/api.ts";
import { getServerCredentialState, type ServerCredentialState } from "../../lib/credentials.ts";
import { usePersistentBoolean } from "../../lib/persistent-state.ts";
import { scoutbotShortcutLabel } from "../../lib/scoutbot-shortcut.ts";
import {
  formatShare,
  formatTokenCount,
  SCOUTBOT_USAGE_OCCASIONS,
  scoutbotRequestInput,
  scoutbotRequestTokens,
  scoutbotSnapshotPartLabel,
  scoutbotUsageLabel,
  summarizeScoutbotUsage,
  type ScoutbotUsageDay,
  type ScoutbotUsageKind,
  type ScoutbotUsageTotals,
  scoutbotTotalsLine,
} from "../../../shared/scoutbot-usage.ts";
import type { Route } from "../../lib/types.ts";
import type { ScoutbotAgentConfig, ScoutbotAgentConfigUpdateResult } from "../../scout/scoutbot/scoutbot-model.ts";
import type { VoiceModelUsage } from "../../../shared/voice-usage.ts";
import "./scoutbot-page.css";
import { ScoutbotRoutines } from "./ScoutbotRoutines.tsx";

/** Shared with the corner mark's own menu (ScoutbotDock). */
const MARK_HIDDEN_KEY = "openscout.scoutbot.mark-hidden";
const USAGE_DAYS = 30;
const LEDGER_FOLDED = 8;
const LEDGER_OPEN = 60;
const PARTS_FOLDED = 6;

type UsageResponse = {
  generatedAt: number;
  since: number;
  days: number;
  records: VoiceModelUsage[];
  truncated: boolean;
};

type ContextSize = { chars: number; parts: { key: string; chars: number }[] };
type ContextMeasure = {
  generatedAt: number;
  instructionsChars: number;
  typed: ContextSize;
  spoken: ContextSize;
};

/* ── pieces, in the settings grammar ────────────────────────────────────── */

function Section({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h2 className="sq-label">{label}</h2>
      <div className="sq-card">{children}</div>
      {note ? <p className="sq-note">{note}</p> : null}
    </section>
  );
}

function Row({ title, detail, children, stack }: { title: ReactNode; detail?: ReactNode; children?: ReactNode; stack?: boolean }) {
  return (
    <div className="sq-row" data-stack={stack || undefined}>
      <div className="sq-row-text">
        <div className="sq-row-title">{title}</div>
        {detail ? <div className="sq-row-detail">{detail}</div> : null}
      </div>
      {children ? <div className="sq-row-control">{children}</div> : null}
    </div>
  );
}

function useLoaded<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError(null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Did not answer.");
    } finally {
      setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, setData, error, loading, reload };
}

/* ── words for figures ──────────────────────────────────────────────────── */

function dayName(start: number): string {
  return new Date(start).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function requestTime(at: number, now: number): string {
  const day = new Date(at);
  const sameDay = new Date(now).toDateString() === day.toDateString();
  const time = day.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

function elapsed(ms: number | null): string {
  if (ms === null) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function providerName(provider: string | null): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "codex") return "Codex";
  return provider ?? "";
}

/** The window's tokens, or nothing when no request in it reported any. */
function Figure({ totals }: { totals: ScoutbotUsageTotals }) {
  if (totals.reported === 0) return totals.requests > 0 ? <span className="sq-value">No token report</span> : null;
  return <span className="sq-bot-figure">{formatTokenCount(totals.tokens)}</span>;
}

/* ── usage: the days ────────────────────────────────────────────────────── */

function UsageDays({ days, total }: { days: ScoutbotUsageDay[]; total: ScoutbotUsageTotals }) {
  const [active, setActive] = useState<number | null>(null);
  const peak = Math.max(1, ...days.map((day) => day.tokens));
  const shown = active === null ? null : days[active] ?? null;
  const first = days[0];
  const last = days[days.length - 1];
  return (
    <div className="sq-bot-days">
      <div className="sq-bot-days-readout" aria-live="polite">
        <span className="sq-bot-days-figure">
          {(shown ?? total).reported > 0 || (shown ?? total).requests === 0 ? (
            <>
              {formatTokenCount((shown ?? total).tokens)}
              <small> tokens</small>
            </>
          ) : <small>No token report</small>}
        </span>
        <span className="sq-bot-days-when">
          {shown ? `${dayName(shown.start)}. ${scoutbotTotalsLine(shown)}` : `Last ${days.length} days. ${scoutbotTotalsLine(total)}`}
        </span>
      </div>
      <div
        className="sq-bot-days-plot"
        role="img"
        aria-label={`Tokens by day over the last ${days.length} days. The busiest day used ${formatTokenCount(peak === 1 && total.tokens === 0 ? 0 : peak)}.`}
        onMouseLeave={() => setActive(null)}
      >
        {days.map((day, index) => {
          const silent = day.tokens === 0 && day.requests > 0;
          return (
            <span
              key={day.start}
              className="sq-bot-day"
              data-active={active === index || undefined}
              data-silent={silent || undefined}
              onMouseEnter={() => setActive(index)}
              onClick={() => setActive(index)}
            >
              <span
                className="sq-bot-day-bar"
                style={{ height: day.tokens > 0 ? `max(2px, ${(day.tokens / peak) * 100}%)` : undefined }}
              />
            </span>
          );
        })}
      </div>
      {first && last ? (
        <div className="sq-bot-days-axis" aria-hidden>
          <span>{dayName(first.start)}</span>
          <span>Today</span>
        </div>
      ) : null}
    </div>
  );
}

/* ── usage: what a request carries ──────────────────────────────────────── */

function SnapshotParts({ measure }: { measure: ContextMeasure }) {
  const [open, setOpen] = useState(false);
  const { typed, spoken, instructionsChars } = measure;
  const parts = open ? typed.parts : typed.parts.slice(0, PARTS_FOLDED);
  const largest = typed.parts[0]?.chars ?? 0;
  return (
    <>
      <div className="sq-bot-parts" role="table" aria-label="The snapshot by part">
        {parts.map((part) => (
          <div className="sq-bot-part" role="row" key={part.key}>
            <span className="sq-bot-part-name" role="cell">{scoutbotSnapshotPartLabel(part.key)}</span>
            <span className="sq-bot-part-track" role="presentation">
              <span style={{ width: largest > 0 ? `${(part.chars / largest) * 100}%` : 0 }} />
            </span>
            <span className="sq-bot-part-share" role="cell">{formatShare(part.chars, typed.chars)}</span>
            <span className="sq-bot-part-size" role="cell">{formatTokenCount(part.chars)}</span>
          </div>
        ))}
        {typed.parts.length > PARTS_FOLDED ? (
          <button type="button" className="sq-bot-more" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {open ? "Show the largest" : "Show every part"}
          </button>
        ) : null}
      </div>
      <div className="sq-fact"><span>The full snapshot</span><span className="sq-mono">{typed.chars.toLocaleString()} characters</span></div>
      <div className="sq-fact"><span>The shorter one, for a spoken reply</span><span className="sq-mono">{spoken.chars.toLocaleString()} characters</span></div>
      <div className="sq-fact"><span>The instructions</span><span className="sq-mono">{instructionsChars.toLocaleString()} characters</span></div>
    </>
  );
}

/* ── usage: the requests themselves ─────────────────────────────────────── */

function Ledger({ records, now }: { records: VoiceModelUsage[]; now: number }) {
  const [open, setOpen] = useState(false);
  const rows = records.slice(0, open ? LEDGER_OPEN : LEDGER_FOLDED);
  return (
    <>
      <div className="sq-bot-ledger-wrap">
      <table className="sq-bot-ledger">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">For</th>
            <th scope="col">Model</th>
            <th scope="col" data-num>In</th>
            <th scope="col" data-num>Out</th>
            <th scope="col" data-num>Total</th>
            <th scope="col" data-num>Took</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((record) => {
            const tokens = scoutbotRequestTokens(record);
            const sent = scoutbotRequestInput(record);
            const unreported = record.state === "completed" && tokens === null;
            return (
              <tr key={record.id} data-state={record.state}>
                <td>{requestTime(record.startedAt, now)}</td>
                <td>{scoutbotUsageLabel(record.mode)}</td>
                <td className="sq-mono">
                  {record.model}
                  {record.provider ? <span className="sq-bot-via"> {providerName(record.provider)}</span> : null}
                </td>
                {record.state === "failed" ? (
                  <td colSpan={3} data-quiet>Failed</td>
                ) : record.state === "pending" ? (
                  <td colSpan={3} data-quiet>Not finished</td>
                ) : unreported ? (
                  <td colSpan={3} data-quiet>No token report</td>
                ) : (
                  <>
                    <td className="sq-mono" data-num>{sent === null ? "" : sent.toLocaleString()}</td>
                    <td className="sq-mono" data-num>{record.outputTokens === null ? "" : record.outputTokens.toLocaleString()}</td>
                    <td className="sq-mono" data-num>{tokens === null ? "" : tokens.toLocaleString()}</td>
                  </>
                )}
                <td className="sq-mono" data-num>{elapsed(record.elapsedMs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {records.length > LEDGER_FOLDED ? (
        <button type="button" className="sq-bot-more" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "Show the latest" : "Show more"}
        </button>
      ) : null}
    </>
  );
}

/* ── the page ───────────────────────────────────────────────────────────── */

function typicalLine(kind: ScoutbotUsageKind | undefined): { figure: string; under: string } {
  if (!kind) return { figure: "", under: `None in ${USAGE_DAYS} days` };
  if (kind.typicalTokens === null) {
    return { figure: "", under: kind.unreported > 0 ? "No token report" : "None completed" };
  }
  const split = kind.typicalIn !== null && kind.typicalOut !== null
    ? `${formatTokenCount(kind.typicalIn)} in, ${formatTokenCount(kind.typicalOut)} out`
    : "";
  return { figure: formatTokenCount(kind.typicalTokens), under: split ? `Typical: ${split}` : "Typical" };
}

export function ScoutbotPage({ navigate }: { navigate: (route: Route) => void }) {
  const loadUsage = useCallback(() => api<UsageResponse>(`/api/scoutbot/usage?days=${USAGE_DAYS}`), []);
  const loadConfig = useCallback(() => api<ScoutbotAgentConfig>("/api/scoutbot/config"), []);
  const loadMeasure = useCallback(() => api<ContextMeasure>("/api/scoutbot/context-size"), []);
  const loadKey = useCallback((): Promise<ServerCredentialState> => getServerCredentialState(), []);
  const usage = useLoaded(loadUsage);
  const config = useLoaded(loadConfig);
  const measure = useLoaded(loadMeasure);
  const key = useLoaded(loadKey);
  const [markHidden, setMarkHidden] = usePersistentBoolean(MARK_HIDDEN_KEY, false);

  const [prompt, setPrompt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ text: string; error?: boolean } | null>(null);

  const records = usage.data?.records ?? [];
  const now = usage.data?.generatedAt ?? Date.now();
  const summary = useMemo(() => summarizeScoutbotUsage(records, now, USAGE_DAYS), [records, now]);
  const kinds = useMemo(() => new Map(summary.kinds.map((kind) => [kind.mode, kind])), [summary.kinds]);

  const save = async (next: { model?: string | null; systemPrompt?: string | null }, done: string) => {
    setSaving(true);
    setSaved(null);
    try {
      const result = await api<ScoutbotAgentConfigUpdateResult>("/api/scoutbot/config", {
        method: "POST",
        body: JSON.stringify(next),
      });
      config.setData(result.config);
      if (next.systemPrompt !== undefined) setPrompt(null);
      setSaved({ text: done });
    } catch (err) {
      setSaved({ text: err instanceof Error && err.message ? err.message : "Could not save.", error: true });
    } finally {
      setSaving(false);
    }
  };

  const current = config.data;
  const promptDraft = prompt ?? current?.systemPrompt ?? "";
  const promptEdited = current !== null && prompt !== null && prompt.trim() !== current.systemPrompt.trim();
  const through = current?.effectiveProvider ?? null;
  const openai = key.data?.openai ?? null;

  return (
    <>
      <Section
        label="Usage"
        note={usage.error
          ? <span style={{ color: "var(--sq-danger)" }}>{usage.error}</span>
          : <>Counted from the requests Scout recorded on this host. A reply made through Codex reports no tokens to Scout, so it is counted as a request and left out of the totals.{usage.data?.truncated ? " This window holds more requests than are shown; the oldest are left out." : ""}</>}
      >
        {usage.loading && !usage.data ? (
          <div className="sq-empty">Loading…</div>
        ) : (
          <>
            <UsageDays days={summary.days} total={summary.window} />
            <Row title="Today" detail={scoutbotTotalsLine(summary.today)}>
              <Figure totals={summary.today} />
            </Row>
            <Row title="Last 7 days" detail={scoutbotTotalsLine(summary.week)}>
              <Figure totals={summary.week} />
            </Row>
            <Row title={`Last ${USAGE_DAYS} days`} detail={scoutbotTotalsLine(summary.window)}>
              <Figure totals={summary.window} />
            </Row>
          </>
        )}
      </Section>

      <Section
        label="When it uses them"
        note="Nothing else here asks a model. Opening Scoutbot, and the rows it shows above the conversation, read Scout's state and send nothing. Replies Scoutbot gives when it is mentioned in a chat are made by its own process and are not counted on this page."
      >
        {SCOUTBOT_USAGE_OCCASIONS.map((occasion) => {
          const typical = typicalLine(kinds.get(occasion.mode));
          return (
            <Row
              key={occasion.mode}
              title={(
                <>
                  {occasion.label}
                  {occasion.unprompted ? <span className="sq-bot-tag">On its own</span> : null}
                </>
              )}
              detail={(
                <>
                  <span className="sq-row-line">{occasion.when}</span>
                  {occasion.carries}
                </>
              )}
            >
              <span className="sq-bot-typical">
                {typical.figure ? <span className="sq-bot-figure">{typical.figure}</span> : null}
                <small>{typical.under}</small>
              </span>
            </Row>
          );
        })}
      </Section>

      <Section
        label="What a typed message carries"
        note={measure.error
          ? <span style={{ color: "var(--sq-danger)" }}>{measure.error}</span>
          : "Measured now, from the state a message would send. Sizes are characters, each part's share is of the snapshot. Most of a request's input tokens are this snapshot, sent again with every message."}
      >
        {measure.data ? <SnapshotParts measure={measure.data} /> : <div className="sq-empty">{measure.loading ? "Measuring…" : "Not measured."}</div>}
      </Section>

      <Section label="Recent requests">
        {records.length > 0
          ? <Ledger records={records} now={now} />
          : <div className="sq-empty">{usage.loading ? "Loading…" : `No requests in the last ${USAGE_DAYS} days.`}</div>}
      </Section>

      <Section
        label="Model"
        note={config.error ? <span style={{ color: "var(--sq-danger)" }}>{config.error}</span> : undefined}
      >
        <Row
          title="Replies come from"
          detail={through === "codex"
            ? "Codex on this host, under your own sign-in. It reports no tokens to Scout."
            : through === "openai"
              ? "Your OpenAI key. Every request reports its tokens."
              : "Not decided until the first reply."}
        >
          {through ? <span className="sq-value">{providerName(through)}</span> : null}
        </Row>
        <Row
          title="Model for typed messages"
          detail={current?.changed?.model ? "Your choice. It is kept across restarts." : "The default."}
        >
          {current ? (
            <>
              {current.changed?.model ? (
                <button type="button" className="sq-button" data-quiet disabled={saving} onClick={() => void save({ model: null }, "Model returned to the default.")}>
                  Use default
                </button>
              ) : null}
              <span className="sq-select-wrap">
                <select
                  className="sq-select"
                  aria-label="Model for typed messages"
                  value={current.model}
                  disabled={saving}
                  onChange={(event) => void save({ model: event.target.value }, "Model saved.")}
                >
                  {(current.modelOptions?.length ? current.modelOptions : [{ id: current.model, label: current.model }]).map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden>
                  <path d="M1.5 3.2 4.5 6l3-2.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </span>
            </>
          ) : null}
        </Row>
        {current?.spokenModel ? (
          <Row title="Model for spoken replies" detail="Set where Scout is started, with OPENSCOUT_SCOUTBOT_VOICE_MODEL.">
            <span className="sq-value">{current.spokenModel}</span>
          </Row>
        ) : null}
        <Row
          title="OpenAI key"
          detail={openai === null ? "Checking…" : openai.configured ? "Saved. Used when a reply goes through OpenAI." : "None. Replies can only go through Codex."}
        >
          <button type="button" className="sq-button" data-quiet onClick={() => navigate({ view: "settings", section: "credentials" })}>
            Keys
          </button>
        </Row>
      </Section>

      <Section
        label="Instructions"
        note={saved
          ? <span style={saved.error ? { color: "var(--sq-danger)" } : undefined}>{saved.text}</span>
          : current?.changed?.systemPrompt
            ? "These are your own instructions, kept across restarts. Scout's later changes to the default will not reach them."
            : "These are Scout's default instructions. They are sent with every request in a conversation."}
      >
        <Row title="What Scoutbot is told" detail={`${promptDraft.length.toLocaleString()} characters.`} stack>
          <textarea
            className="sq-textarea sq-mono"
            aria-label="Scoutbot's instructions"
            rows={12}
            value={promptDraft}
            disabled={!current || saving}
            spellCheck={false}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <div className="sq-bot-actions">
            {current?.changed?.systemPrompt ? (
              <button type="button" className="sq-button" data-quiet disabled={saving} onClick={() => void save({ systemPrompt: null }, "Instructions returned to the default.")}>
                Return to default
              </button>
            ) : null}
            {promptEdited ? (
              <button type="button" className="sq-button" data-quiet disabled={saving} onClick={() => setPrompt(null)}>
                Discard
              </button>
            ) : null}
            <button
              type="button"
              className="sq-button"
              disabled={saving || !promptEdited || !promptDraft.trim()}
              onClick={() => void save({ systemPrompt: promptDraft }, "Instructions saved.")}
            >
              {saving ? "Saving" : "Save"}
            </button>
          </div>
        </Row>
      </Section>

      <ScoutbotRoutines briefingModels={current?.modelOptions} onOpenBriefing={(briefingId) => navigate({ view: "briefings", briefingId })} />

      <Section label="In the app">
        <Row title="Keep Scoutbot in the corner" detail={`Turn this off and Scoutbot stays out of the way until you press ${scoutbotShortcutLabel()}.`}>
          <button
            type="button"
            role="switch"
            aria-checked={!markHidden}
            aria-label="Keep Scoutbot in the corner"
            className="sq-toggle"
            onClick={() => setMarkHidden(!markHidden)}
          >
            <span aria-hidden />
          </button>
        </Row>
        <Row title="Voice" detail="How Scoutbot hears you and how it sounds.">
          <button type="button" className="sq-button" data-quiet onClick={() => navigate({ view: "settings", section: "voice" })}>
            Voice
          </button>
        </Row>
      </Section>
    </>
  );
}
