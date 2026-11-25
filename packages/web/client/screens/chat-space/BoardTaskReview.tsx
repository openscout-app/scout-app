import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import { hostFleet } from "../../lib/hosts/host-fleet.ts";
import { randomUuid } from "../../lib/random-id.ts";
import {
  recordReviewRefusal, readReviewAttempts, reserveReviewAttempt, reviewAttemptStorageKey, reviewIntentKey, reviewRoutinesForRoom,
  reviewRunFailure, reviewRunRequest, reviewWorkHref, selectReviewRoutine, storeReviewReceipt, withReviewLedger,
  type BoardReviewAttempt, type BoardReviewPreview, type BoardReviewRoutine, type BoardReviewScope,
} from "./board-review.ts";

const API = "/api/manual-review";
const HARNESS_LABEL = { codex: "Codex", claude: "Claude" };

type Draft = Pick<BoardReviewRoutine, "id" | "version" | "name" | "projectPath" | "harness" | "enabled">;
type Ticket = { workId?: string };

// Accessing the localStorage property itself can throw (for example when
// browser policy blocks storage). Keep that access inside the guarded calls.
const retryStorage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};

function post<T>(path: string, body: object) {
  return api<T>(`${API}/${path}`, { method: "POST", body: JSON.stringify(body) });
}

export function BoardTaskReview({ connectionId, channel, itemId, snapshot, roomStale, reloadRoom, hostId }: BoardReviewScope & {
  itemId: string;
  /** Local mirror fingerprint, for invalidation only. The preview supplies the authoritative version. */
  snapshot: string;
  roomStale: boolean;
  reloadRoom?: () => Promise<void>;
  hostId: string;
}) {
  const storageKey = reviewAttemptStorageKey(hostId, { connectionId, channel }, itemId);
  const [attempts, setAttempts] = useState(() => readReviewAttempts(retryStorage, storageKey));
  const [routines, setRoutines] = useState<BoardReviewRoutine[] | null>(null);
  const [selected, setSelected] = useState<string | null>(() => attempts[0]?.routineId ?? null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [checked, setChecked] = useState<{ preview: BoardReviewPreview; snapshot: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const lock = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const routine = routines ? selectReviewRoutine(routines, selected) : null;
  const pending = attempts.find(attempt => attempt.workId === undefined && !attempt.retryOnly && (routine ? attempt.routineId === routine.id : true));
  const previousTicket = attempts.find(attempt => attempt.routineId === routine?.id && reviewWorkHref(attempt.workId))
    ?? attempts.find(attempt => reviewWorkHref(attempt.workId));
  const ticketHref = reviewWorkHref(previousTicket?.workId);
  const preview = checked?.preview;
  const previewCurrent = Boolean(preview && routine?.enabled && !draft && !roomStale
    && preview.routine.id === routine.id && preview.routine.version === routine.version && checked.snapshot === snapshot);
  const matching = preview && attempts.find(attempt => attempt.key === reviewIntentKey(preview));
  const sameRunFinished = matching && matching.workId !== undefined;

  async function readRoutines(signal?: AbortSignal) {
    const scope = { connectionId, channel };
    const result = await api<{ routines: BoardReviewRoutine[] }>(
      `${API}/board-routines?${new URLSearchParams(scope)}`, { signal },
    );
    return reviewRoutinesForRoom(result.routines, scope);
  }

  useEffect(() => {
    const controller = new AbortController();
    void readRoutines(controller.signal).then(next => {
      if (!controller.signal.aborted) setRoutines(next);
    }, cause => {
      if (!controller.signal.aborted) setError(message(cause));
    });
    return () => controller.abort();
  }, [connectionId, channel, hostId]);

  useEffect(() => {
    if (roomStale) setChecked(null);
  }, [roomStale]);

  function message(cause: unknown) {
    return cause instanceof Error ? cause.message : "The runtime did not answer.";
  }

  async function perform(label: string, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      if (hostFleet.focused().id !== hostId) throw new Error("The active host changed. Reopen the Board task.");
      await action();
    } catch (cause) {
      setError(message(cause));
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  function edit(value: Draft) {
    setChecked(null);
    setError(null);
    setNotice(null);
    setDraft(value);
  }

  function save() {
    if (!draft) return;
    const { version, ...fields } = draft;
    void perform("Saving…", async () => {
      try {
        await post("board-routines", {
          ...fields, name: fields.name.trim(), projectPath: fields.projectPath.trim(),
          connectionId, channel, expectedVersion: version,
        });
      } catch (cause) {
        if ((cause as { status?: number }).status === 409) {
          setChecked(null);
          setDraft(null);
          setRoutines(null);
          setRoutines(await readRoutines());
          throw new Error("The reviewer changed. Open the latest saved reviewer before editing it again.");
        }
        throw cause;
      }
      setSelected(fields.id);
      setDraft(null);
      setRoutines(null);
      setRoutines(await readRoutines());
    });
  }

  function check() {
    if (!routine?.enabled || roomStale) return;
    setChecked(null);
    void perform("Checking…", async () => {
      const next = await post<BoardReviewPreview>("board-preview", { routineId: routine.id, itemId });
      if (!next.routine.enabled || next.routine.version !== routine.version || next.routine.id !== routine.id
        || next.routine.connectionId !== connectionId || next.routine.channel !== channel) {
        setRoutines(null);
        setRoutines(await readRoutines());
        throw new Error("The saved reviewer changed. Check the preview again.");
      }
      setChecked({ preview: next, snapshot });
    });
  }

  async function receive(attempt: BoardReviewAttempt, ticket: Ticket) {
    const workId = ticket.workId ?? null;
    setAttempts(current => [{ ...attempt, workId }, ...current.filter(entry => entry.requestId !== attempt.requestId)]);
    try {
      await withReviewLedger(storageKey, () => storeReviewReceipt(retryStorage, storageKey, attempt, workId));
    } catch {
      setNotice("This browser could not save the ticket link. After reopening the task, use Check run to find it again.");
      return;
    }
    if (!workId) setNotice("The runtime returned no work ticket for this run.");
  }

  function run() {
    if (!previewCurrent || !preview || sameRunFinished) return;
    void perform("Starting…", async () => {
      let attempt: BoardReviewAttempt;
      try {
        attempt = await withReviewLedger(storageKey, () => reserveReviewAttempt(retryStorage, storageKey, preview));
      } catch {
        throw new Error("Scout could not save the retry ID in this browser. No review was started.");
      }
      if (attempt.workId !== undefined) {
        setAttempts(readReviewAttempts(retryStorage, storageKey));
        return;
      }
      setAttempts(readReviewAttempts(retryStorage, storageKey));
      if (hostFleet.focused().id !== hostId) throw new Error("The active host changed. Reopen the Board task.");
      let answer: { ticket: Ticket };
      try {
        answer = await post("board-runs", reviewRunRequest(preview, itemId, attempt));
      } catch (cause) {
        setChecked(null);
        const failure = reviewRunFailure(cause);
        if (failure !== "uncertain") {
          try {
            setAttempts(await withReviewLedger(storageKey, () =>
              recordReviewRefusal(retryStorage, storageKey, attempt.requestId, failure === "refused")));
          } catch { /* Keep the existing ID if storage is unavailable. */ }
          if (hostFleet.focused().id === hostId) {
            try { setRoutines(await readRoutines()); } catch { /* Keep the original refusal. */ }
            void reloadRoom?.();
          }
        }
        throw cause;
      }
      await receive(attempt, answer.ticket);
    });
  }

  function checkRun(attempt: BoardReviewAttempt) {
    void perform("Checking run…", async () => {
      const query = new URLSearchParams({ scope: `board-review:${attempt.routineId}`, requestId: attempt.requestId });
      try {
        const { occurrence } = await api<{ occurrence: { state: string; dispatch?: { ticket?: Ticket } } }>(
          `${API}/occurrences?${query}`,
        );
        if (occurrence.dispatch?.ticket) {
          await receive(attempt, occurrence.dispatch.ticket);
        } else if (occurrence.state === "refused") {
          setAttempts(await withReviewLedger(storageKey, () => recordReviewRefusal(retryStorage, storageKey, attempt.requestId, true)));
          setChecked(null);
          setNotice("The reviewer did not start. Preview again before requesting a new run.");
        } else {
          setNotice("There is no ticket yet. If the preview still matches, retry the same run.");
        }
      } catch (cause) {
        if ((cause as { status?: number }).status !== 404) throw cause;
        setNotice("No receipt yet. If you retry the same preview, Scout will use the same request ID.");
      }
    });
  }

  return (
    <section className="vbt-review" aria-label="Board review">
      <h4>Board review</h4>
      {routines === null ? (
        error ? <button type="button" className="btn btn--sm" disabled={!!busy}
          onClick={() => void perform("Loading…", async () => setRoutines(await readRoutines()))}>Reload reviewers</button>
          : <p>Loading reviewers…</p>
      ) : draft ? (
        <form className="vbt-review-fields" onSubmit={event => { event.preventDefault(); save(); }}>
          <label>Name<input autoFocus required value={draft.name} disabled={!!busy}
            onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>Git project path<input required value={draft.projectPath} placeholder="/absolute/path/to/project" disabled={!!busy}
            onChange={event => setDraft({ ...draft, projectPath: event.target.value })} /></label>
          <label>Harness<select value={draft.harness} disabled={!!busy}
            onChange={event => setDraft({ ...draft, harness: event.target.value === "claude" ? "claude" : "codex" })}>
            <option value="codex">Codex</option><option value="claude">Claude</option>
          </select></label>
          <label className="vbt-review-check"><input type="checkbox" checked={draft.enabled} disabled={!!busy}
            onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />Enabled</label>
          <div className="vbt-review-actions">
            <button type="submit" className="btn btn--sm" disabled={!!busy || !draft.name.trim() || !draft.projectPath.trim().startsWith("/")}>Save reviewer</button>
            <button type="button" className="btn btn--sm" disabled={!!busy} onClick={() => { setDraft(null); setError(null); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          {routine ? (
            <>
              <label className="vbt-review-picker">Saved reviewer
                <select value={routine.id} disabled={!!busy} onChange={event => {
                  setSelected(event.target.value); setChecked(null); setError(null); setNotice(null);
                }}>
                  {routines.map(item => <option key={item.id} value={item.id}>{item.name}{!item.enabled ? " (disabled)" : ""}</option>)}
                </select>
              </label>
              <p className="vbt-review-target">{HARNESS_LABEL[routine.harness]} <code>{routine.projectPath}</code></p>
            </>
          ) : <p>No reviewers saved for this room.</p>}
          <div className="vbt-review-actions">
            <button type="button" className="btn btn--sm" disabled={!!busy}
              onClick={() => edit({ id: randomUuid(), version: 0, name: "", projectPath: "", harness: "codex", enabled: true })}>New reviewer</button>
            {routine ? <button type="button" className="btn btn--sm" disabled={!!busy} onClick={() => edit(routine)}>Edit reviewer</button> : null}
          </div>
          {routine && !routine.enabled ? <p>Enable this reviewer to run it.</p> : null}
          {routine?.enabled && roomStale ? <p>The Board copy is stale. Refresh before previewing.</p> : null}
          {checked && !previewCurrent && !roomStale ? <p>The task or reviewer changed. Check the preview again.</p> : null}
          {previewCurrent && preview ? (
            <dl className="vbt-facts vbt-review-evidence">
              <dt>Board version</dt><dd><code>{preview.input.version}</code></dd>
              <dt>Artifact</dt><dd><code>{preview.artifact.ref}</code></dd>
              <dt>Git commit</dt><dd><code>{preview.artifact.revision}</code></dd>
            </dl>
          ) : null}
          {routine?.enabled ? <div className="vbt-review-actions">
            {roomStale
              ? <button type="button" className="btn btn--sm" disabled={!!busy || !reloadRoom} onClick={() => {
                void perform("Refreshing…", async () => { setChecked(null); await reloadRoom?.(); });
              }}>Refresh Board</button>
              : <button type="button" className="btn btn--sm" disabled={!!busy} onClick={check}>{checked ? "Recheck preview" : "Preview"}</button>}
            <button type="button" className="btn btn--accent btn--sm" disabled={!!busy || !previewCurrent || !!sameRunFinished}
              onClick={run}>{matching && !matching.retryOnly && !sameRunFinished ? "Retry run" : "Run now"}</button>
          </div> : null}
          {sameRunFinished && previewCurrent ? <p>{matching.workId ? "A review already ran for this preview." : "This run has no work ticket."}</p> : null}
        </>
      )}
      <div className="vbt-review-actions">
        {ticketHref ? <a href={ticketHref} className="btn btn--sm">Open last review ticket</a> : null}
        {pending ? <button type="button" className="btn btn--sm" disabled={!!busy}
          onClick={() => checkRun(pending)}>Check run</button> : null}
      </div>
      <p role="status">{busy ?? notice}</p>
      {error ? <p className="vbt-review-error" role="alert">{error}</p> : null}
    </section>
  );
}
