import { useCallback, useMemo, useState } from "react";
import { X } from "lucide-react";
import { extractScoutbotOffers, type ScoutbotOffer } from "../../lib/scoutbot.ts";
import { scoutbotOfferMarkKey, useScoutbotMarks } from "../../lib/scoutbot-marks.ts";
import { scoutbotPageForRoute } from "../../../shared/scoutbot-navigation.ts";

/**
 * The next steps Scoutbot offers under a reply. Each is the same row as the
 * next stack: who or what it is about, what it is, and one verb. Nothing here
 * runs until the operator taps the verb, and a message to an agent is shown
 * whole before it can be sent.
 *
 * An offer belongs to the reply it came with. Once the conversation moves on,
 * an offer nobody took is gone; one that was sent stays as a line saying so.
 * Not now sets a row aside in this browser.
 */

export type ScoutbotAskOffer = Extract<ScoutbotOffer, { type: "ask-agent" }>;

export type ScoutbotOfferRow = {
  who: string;
  what: string;
  /** Why Scoutbot offers it, in its own words. */
  why: string | null;
  verb: string;
};

function fileName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** How an offer reads as a row. */
export function scoutbotOfferRow(offer: ScoutbotOffer): ScoutbotOfferRow {
  const why = offer.reason?.trim() || null;
  switch (offer.type) {
    case "navigate":
      return {
        who: scoutbotPageForRoute(offer.route)?.label ?? "Scout",
        what: why ?? "",
        why: null,
        verb: "Go",
      };
    case "view-file":
      return { who: fileName(offer.path), what: why ?? offer.path, why: null, verb: "Open" };
    case "ask-agent":
      return { who: offer.targetLabel, what: offer.body, why, verb: "Send" };
  }
}

export function ScoutbotOfferRows({
  messageId,
  body,
  latest,
  onRun,
  onSend,
}: {
  messageId: string;
  /** The reply as Scoutbot wrote it, action block included. */
  body: string;
  /** Whether this is the reply the conversation currently ends on. */
  latest: boolean;
  onRun: (offer: Exclude<ScoutbotOffer, ScoutbotAskOffer>) => void;
  onSend: (offer: ScoutbotAskOffer) => Promise<void>;
}) {
  const [marks, mark] = useScoutbotMarks();
  const offers = useMemo(() => extractScoutbotOffers(body), [body]);
  const [sendingIndex, setSendingIndex] = useState<number | null>(null);
  const [failures, setFailures] = useState<Readonly<Record<number, string>>>({});

  const send = useCallback((offer: ScoutbotAskOffer, index: number) => {
    setSendingIndex(index);
    setFailures((current) => {
      const { [index]: _cleared, ...rest } = current;
      return rest;
    });
    onSend(offer).then(() => {
      mark(scoutbotOfferMarkKey(messageId, index), "sent");
    }).catch((error: unknown) => {
      const detail = error instanceof Error && error.message ? error.message : "Could not send.";
      setFailures((current) => ({ ...current, [index]: detail }));
    }).finally(() => {
      setSendingIndex((current) => (current === index ? null : current));
    });
  }, [mark, messageId, onSend]);

  const rows = offers
    .map((offer, index) => ({ offer, index, state: marks[scoutbotOfferMarkKey(messageId, index)] }))
    .filter((row) => row.state === "sent" || (row.state !== "held" && latest));
  if (rows.length === 0) return null;

  return (
    <ul
      aria-label="Offered by Scoutbot"
      className="m-0 flex list-none flex-col border-y border-[var(--scout-chrome-border-soft)] p-0"
    >
      {rows.map(({ offer, index, state }) => {
        const row = scoutbotOfferRow(offer);
        const sent = state === "sent";
        const sending = sendingIndex === index;
        const failure = failures[index];
        const draft = offer.type === "ask-agent" && !sent;
        return (
          <li
            key={index}
            className="group/offer grid grid-cols-[80px_minmax(0,1fr)_auto_auto] items-start gap-x-2 border-t border-[var(--scout-chrome-border-soft)] py-1.5 text-xs leading-5 first:border-t-0"
          >
            <span className="truncate text-[var(--scout-chrome-ink-faint)]" title={row.who}>
              {row.who}
            </span>
            <span className="flex min-w-0 flex-col">
              <span
                className={draft
                  ? "max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-[var(--scout-chrome-ink)]"
                  : `truncate ${sent ? "text-[var(--scout-chrome-ink-faint)]" : "text-[var(--scout-chrome-ink)]"}`}
                title={draft ? undefined : row.what}
              >
                {row.what}
              </span>
              {row.why && !sent ? (
                <span className="truncate text-[var(--scout-chrome-ink-ghost)]" title={row.why}>{row.why}</span>
              ) : null}
              {failure ? (
                <span role="alert" className="break-words text-[var(--hud-status-error)]">{failure}</span>
              ) : null}
            </span>
            {sent ? (
              <span className="px-1.5 text-[var(--scout-chrome-ink-ghost)]">Sent</span>
            ) : (
              <button
                type="button"
                disabled={sending}
                onClick={() => {
                  if (offer.type === "ask-agent") send(offer, index);
                  else onRun(offer);
                }}
                className="rounded px-1.5 text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sending ? "Sending" : failure ? "Retry" : row.verb}
              </button>
            )}
            {sent ? (
              <span className="w-5" aria-hidden="true" />
            ) : (
              <button
                type="button"
                title="Not now"
                aria-label={`Not now: ${row.who}`}
                disabled={sending}
                onClick={() => mark(scoutbotOfferMarkKey(messageId, index), "held")}
                className="flex h-5 w-5 items-center justify-center rounded text-[var(--scout-chrome-ink-ghost)] opacity-0 transition hover:bg-[var(--scout-chrome-hover)] hover:text-[var(--scout-chrome-ink)] focus-visible:opacity-100 disabled:cursor-not-allowed group-hover/offer:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <X size={11} aria-hidden="true" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
