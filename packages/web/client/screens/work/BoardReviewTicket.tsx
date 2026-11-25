import { useEffect, useRef, useState } from "react";
import { hostFleet } from "../../lib/hosts/host-fleet.ts";
import { LOCAL_HOST_ID } from "../../lib/hosts/host-client.ts";
import { api } from "../../lib/api.ts";

export interface BoardReviewTicketRecord {
  workId: string;
  state: string;
  acceptanceState: string;
  input: { source: string; id: string; version: string };
  artifact: { kind: string; ref: string; revision: string };
  routine: { id: string; version: number };
  target: { kind: "project_path"; projectPath: string; harness: string };
}

export function isBoardReviewWorkId(workId: string) {
  return workId.startsWith("work-manual-review-");
}

const POLL_MS = 15_000;

type View = { ticket: BoardReviewTicketRecord | null; hidden?: boolean; forbidden?: boolean; error?: string; notice?: string };
const INITIAL: View = { ticket: null };

function isPending(ticket: BoardReviewTicketRecord | null) {
  return ticket?.state === "review" && ticket.acceptanceState === "pending";
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : "Could not reach the Scout runtime.";
}

function verifyTicket(ticket: BoardReviewTicketRecord, workId: string) {
  if (ticket?.workId !== workId) throw new Error("The runtime returned a different review ticket.");
  return ticket;
}

export function useBoardReviewTicket(workId: string) {
  const [entry, setEntry] = useState<{ id: string; view: View }>();
  const [savingId, setSavingId] = useState<string | null>(null);
  const operations = useRef<{ refresh: () => void; accept: () => void } | null>(null);

  useEffect(() => {
    if (!isBoardReviewWorkId(workId)) return;
    const path = `/api/manual-review/board-tickets/${encodeURIComponent(workId)}`;
    const lifetime = new AbortController();
    let view = INITIAL;
    let read: AbortController | undefined;
    let saving = false;
    let timer: ReturnType<typeof setInterval>;
    const active = () => !lifetime.signal.aborted;
    const update = (next: View) => {
      if (!active()) return;
      view = next;
      if (next.hidden || next.forbidden || next.ticket?.acceptanceState === "accepted") clearInterval(timer);
      setEntry({ id: workId, view: next });
    };

    async function refresh(afterAccept = false, refusal?: string) {
      if (!active() || read || (saving && !afterAccept) || view.hidden || view.forbidden || view.ticket?.acceptanceState === "accepted"
          || hostFleet.focused().id !== LOCAL_HOST_ID) return;
      const controller = new AbortController();
      read = controller;
      try {
        const ticket = verifyTicket(await api<BoardReviewTicketRecord>(path, { signal: controller.signal }), workId);
        if (!controller.signal.aborted) {
          update({ ticket, notice: ticket.acceptanceState === "accepted" ? undefined : refusal ??
            (afterAccept && isPending(ticket) ? "The review is still pending. You can try accepting it again." : undefined) });
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        const status = (cause as { status?: number })?.status;
        if (status === 404) {
          update(refusal ? { ticket: null, forbidden: true, error: refusal } : { ticket: null, hidden: true });
        } else if (status === 403) {
          update({ ticket: null, forbidden: true, error: errorMessage(cause) });
        } else {
          update({ ticket: view.ticket, notice: refusal, error: afterAccept && !refusal
            ? "Could not confirm acceptance. Refresh the ticket before trying again."
            : errorMessage(cause) });
        }
      } finally {
        if (read === controller) read = undefined;
      }
    }

    async function accept() {
      if (!active() || saving || !isPending(view.ticket) || view.error || hostFleet.focused().id !== LOCAL_HOST_ID) return;
      saving = true;
      setSavingId(workId);
      // An earlier poll must not overwrite the write's verified response.
      read?.abort();
      read = undefined;
      try {
        const ticket = verifyTicket(await api<BoardReviewTicketRecord>(`${path}/accept`, {
          method: "POST", signal: lifetime.signal,
        }), workId);
        update({ ticket });
      } catch (cause) {
        const { status, code } = (cause as { status?: number; code?: string }) ?? {};
        if (status === 403) {
          update({ ticket: view.ticket, forbidden: true, error: errorMessage(cause) });
        } else {
          const refusal = code === "board_review_not_ready" || code === "board_ticket_not_found" || status === 401
            ? errorMessage(cause) : undefined;
          await refresh(true, refusal);
        }
      } finally {
        saving = false;
        if (active()) setSavingId(null);
      }
    }

    operations.current = { refresh: () => { void refresh(); }, accept: () => { void accept(); } };
    setSavingId(null);
    update(INITIAL);
    void refresh();
    timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => {
      operations.current = null;
      lifetime.abort();
      read?.abort();
      clearInterval(timer);
    };
  }, [workId]);

  const view = entry?.id === workId ? entry.view : INITIAL;
  const saving = savingId === workId;
  return {
    ...view, saving,
    canAccept: !view.error && !saving && isPending(view.ticket),
    refresh: () => operations.current?.refresh(),
    accept: () => operations.current?.accept(),
  };
}

function ticketStatus(ticket: BoardReviewTicketRecord) {
  if (ticket.acceptanceState === "accepted") return "Accepted";
  if (isPending(ticket)) return "Waiting for your acceptance";
  if (ticket.state === "done" || ticket.state === "completed") return "Completed";
  if (ticket.state === "waiting") return "Waiting";
  if (ticket.state === "working") return "Review in progress";
  if (ticket.state === "review") return "In review";
  return ticket.state.replaceAll("_", " ");
}

export function BoardReviewTicket({ workId }: { workId: string }) {
  const { ticket, hidden, forbidden, error, notice, saving, canAccept, refresh, accept } = useBoardReviewTicket(workId);
  if (hidden || !isBoardReviewWorkId(workId)) return null;
  return (
    <section aria-label="Board review" style={{
      flex: "0 0 auto", maxBlockSize: "65%", overflowY: "auto", overflowWrap: "anywhere",
      borderBlockEnd: "1px solid var(--scout-line)", padding: "var(--space-md) var(--space-3xl)",
      display: "grid", gap: "var(--space-sm)",
    }}>
      <header className="s-wc-card-head"><h2>Board review</h2>
        <span className="s-wc-note" role="status">{saving ? "Accepting…" : notice ?? (ticket ? ticketStatus(ticket) : error ? "" : "Loading review ticket…")}</span>
      </header>
      {ticket ? (
        <dl style={{ display: "grid", gridTemplateColumns: "minmax(0, max-content) minmax(0, 1fr)", gap: "var(--space-xs) var(--space-md)", margin: 0 }}>
          <dt>Saved routine</dt><dd style={{ margin: 0 }}><code>{ticket.routine.id}</code> · Version {ticket.routine.version}</dd>
          <dt>Board item</dt><dd style={{ margin: 0 }}><code>{ticket.input.id}</code> · Version <code>{ticket.input.version}</code></dd>
          <dt>Repository revision</dt><dd style={{ margin: 0 }}><code>{ticket.artifact.revision}</code><br /><span className="s-wc-note">{ticket.artifact.ref}</span></dd>
          <dt>Reviewer</dt><dd style={{ margin: 0 }}>{ticket.target.harness === "codex" ? "Codex" : ticket.target.harness === "claude" ? "Claude" : ticket.target.harness} · <code>{ticket.target.projectPath}</code></dd>
        </dl>
      ) : null}
      {error ? <p className="s-wc-note" role="alert">{error}</p> : null}
      <div className="s-wc-card-head">
        {isPending(ticket) ? <button type="button" className="btn btn--accent btn--sm" disabled={!canAccept} onClick={accept}>{saving ? "Accepting…" : "Accept review"}</button> : null}
        {error && !forbidden ? <button type="button" className="btn btn--sm" disabled={saving} onClick={refresh}>Refresh ticket</button> : null}
      </div>
    </section>
  );
}
