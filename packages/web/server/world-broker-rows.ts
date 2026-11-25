/**
 * World · broker deliveries: the messages the broker could not get to their recipient, read the same way by the
 * snapshot collector (world-hosts.ts) and the live tail (world-tail.ts). Portable on purpose (bun:sqlite handle in,
 * plain rows out, world-transcript.ts for the redactor only) — the tail bundles it for ssh.
 *
 * Only deliveries that can be trouble travel: a message (not an ask — an ask's own delivery is the ask, already drawn)
 * to an agent or a session (not the operator's polled inbox, which waits for its reader by design) that FAILED, or is
 * still pending / running. Delivered ones are left at home: the broker records no delivery time for them.
 */
import { redact, squash } from "./world-transcript.ts";

/** [the delivery's id, created, finished (null while open), broker status, message sender id, target id, target name, transport, text, error]
 *  and the ids an operator acts on: the message, its conversation, the flight it reports on (when it is one), and, when
 *  the target is a session that has ended (no live endpoint or runtime session left), when it ended. */
export type BrokerDelivery = { id: string; created_at: number; done_at: number | null; status: string; from: string; to: string; to_name: string | null; transport: string; text: string; error: string | null;
  message_id?: string | null; conversation_id?: string | null; flight_id?: string | null; ended_at?: number | null };
export const OPEN_DELIVERY = new Set(["pending", "running", "queued", "leased", "retrying"]);
export const deliveryState = (status: string | null | undefined): "o" | "c" | "f" => status === "failed" ? "f" : OPEN_DELIVERY.has(String(status || "")) ? "o" : "c";

const COLS = `d.rowid as rid, d.id, d.created_at, d.status, d.target_id, d.target_kind, d.transport, d.metadata_json, d.message_id, m.actor_id, m.body, m.conversation_id, m.metadata_json as message_metadata_json,
  (select x.display_name from actors x where x.id = d.target_id) as to_name,
  (select a.error from delivery_attempts a where a.delivery_id = d.id and a.error is not null order by a.created_at desc limit 1) as attempt_error`;
const TROUBLE = `d.message_id is not null and d.target_id != 'operator' and d.transport != 'mcp_poll'
  and (d.metadata_json is null or json_extract(d.metadata_json, '$.invocationId') is null)`;

const idOf = (v: unknown): string | null => typeof v === "string" && v && v.length <= 200 ? v : null;
function row(r: any): BrokerDelivery {
  let md: Record<string, any> = {}; try { md = JSON.parse(r.metadata_json || "{}") || {}; } catch {}
  let mm: Record<string, any> = {}; try { mm = JSON.parse(r.message_metadata_json || "{}") || {}; } catch {}
  const st = deliveryState(r.status), at = Number(md.statusUpdatedAt || md.failedAt || md.completedAt) || null;
  const err = r.attempt_error || md.failureDetail || md.error || null;
  return {
    id: String(r.id), created_at: Number(r.created_at), done_at: st === "o" ? null : Math.max(Number(r.created_at), at || Number(r.created_at)), status: String(r.status || ""),
    from: String(r.actor_id || ""), to: String(r.target_id || ""), to_name: r.to_name ? String(r.to_name).slice(0, 80) : null, transport: String(r.transport || "").slice(0, 32),
    text: redact(String(r.body || "").replace(/\s+/g, " ").slice(0, 400)).slice(0, 200), error: err ? redact(String(err).replace(/\s+/g, " ").slice(0, 400)).slice(0, 200) : null,
    message_id: idOf(r.message_id), conversation_id: idOf(r.conversation_id), flight_id: idOf(mm.flightId) || idOf(mm.completionReply?.flightId) || idOf(md.flightId),
    ended_at: null,
  };
}

/** A session can end; an agent sleeps and is woken for its mail. So only a session target (a participant, or a
 *  session-… actor) reads as ended: it has an endpoint or a runtime session on record and none of them is live.
 *  Returns when it ended (the latest end the runtime recorded). Tables an older runtime lacks: nothing reads as ended. */
const ENDED_ENDPOINT = new Set(["offline", "stopped"]);
export function sessionEndedAt(db: any, targetId: string): number | null {
  let ended: number | null = null, seen = false;
  try {
    for (const r of db.query("select state, ended_at, last_seen_at from runtime_sessions where agent_id = ?").all(targetId) as any[]) {
      seen = true;
      if (r.ended_at == null && r.state !== "offline" && r.state !== "superseded") return null;
      ended = Math.max(ended ?? 0, Number(r.ended_at ?? r.last_seen_at) || 0);
    }
  } catch {}
  try {
    for (const r of db.query("select state, updated_at from agent_endpoints where agent_id = ?").all(targetId) as any[]) {
      seen = true;
      if (!ENDED_ENDPOINT.has(String(r.state))) return null;
      ended = Math.max(ended ?? 0, Number(r.updated_at) || 0);
    }
  } catch {}
  return seen ? ended || null : null;
}
const sessionTarget = (r: any) => r.target_kind === "participant" || /^session-/.test(String(r.target_id || ""));
/** Rows out, with ended_at filled for open deliveries to a session that has ended (one lookup per target). */
function rowsOf(db: any, list: any[]): BrokerDelivery[] {
  const ended = new Map<string, number | null>();
  return list.map(r => {
    const d = row(r);
    if (deliveryState(d.status) === "o" && sessionTarget(r)) {
      if (!ended.has(d.to)) ended.set(d.to, sessionEndedAt(db, d.to));
      d.ended_at = ended.get(d.to) ?? null;
    }
    return d;
  });
}

/** The ids a payload row carries, as indexes into its strs table (-1: none). See WorldDlv in world-week.ts. */
export type DlvRow = [number, number | null, string, number, string, string, string, number, number, number, number, number, number | null];
export function dlvRow(d: BrokerDelivery, sender: number, S: (s: string) => number): DlvRow {
  const ref = (v: string | null | undefined) => v ? S(v) : -1;
  return [d.created_at, d.done_at, deliveryState(d.status), sender, squash(d.to_name || d.to, 60), squash(d.text, 96), squash(d.error || "", 90),
    ref(d.id), ref(d.to), ref(d.message_id), ref(d.flight_id), ref(d.conversation_id), d.ended_at ?? null];
}
/** An ask's ids, the same way: [invocation, flight, conversation], or nothing when it has none (the tuple stays short) */
export function askRefs(a: { id?: string | null; flight_id?: string | null; conversation_id?: string | null } | undefined, S: (s: string) => number): [] | [number, number, number] {
  if (!a || !(a.id || a.flight_id || a.conversation_id)) return [];
  const ref = (v: string | null | undefined) => v ? S(v) : -1;
  return [ref(a.id), ref(a.flight_id), ref(a.conversation_id)];
}
/** The invocations columns for an ask's ids, or nulls on a runtime that predates them */
export function invocationRefCols(db: any): string {
  try {
    const cols = new Set((db.query("select name from pragma_table_info('invocations')").all() as any[]).map(r => r.name));
    return `${cols.has("flight_id") ? "flight_id" : "null as flight_id"}, ${cols.has("conversation_id") ? "conversation_id" : "null as conversation_id"}`;
  } catch { return "null as flight_id, null as conversation_id"; }
}

/** The snapshot: every trouble delivery made since `from` — failed ones and ones still open. */
export function readTroubleDeliveries(db: any, from: number): BrokerDelivery[] {
  try {
    return rowsOf(db, db.query(`select ${COLS} from deliveries d left join messages m on m.id = d.message_id
      where d.created_at > ? and ${TROUBLE} and (d.status = 'failed' or d.status in (${[...OPEN_DELIVERY].map(s => `'${s}'`).join(",")})) order by d.created_at`).all(from) as any[]);
  } catch { return []; }
}

/** One trouble delivery that is still open, by id, or null: what the Overview may dismiss (routes/world.ts) */
export function readOpenTroubleDelivery(db: any, id: string): BrokerDelivery | null {
  try {
    const r = db.query(`select ${COLS} from deliveries d left join messages m on m.id = d.message_id where d.id = ? and ${TROUBLE}`).get(id) as any;
    if (!r || deliveryState(r.status) !== "o") return null;
    return rowsOf(db, [r])[0] ?? null;
  } catch { return null; }
}

/** The tail: trouble deliveries new since rowid `after`, plus the ones still open last time (re-sent once they finish). */
export function readDeliveriesSince(db: any, from: number, after: number, open: string[]): { rows: BrokerDelivery[]; maxRow: number; open: string[] } {
  try {
    const fresh = db.query(`select ${COLS} from deliveries d left join messages m on m.id = d.message_id where d.rowid > ? and d.created_at > ? and ${TROUBLE} order by d.rowid limit 2000`).all(after, from) as any[];
    const again = open.length ? db.query(`select ${COLS} from deliveries d left join messages m on m.id = d.message_id where d.id in (${open.map(() => "?").join(",")})`).all(...open) as any[] : [];
    let maxRow = after; for (const r of fresh) maxRow = Math.max(maxRow, Number(r.rid) || 0);
    const wasOpen = new Set(open), seen = new Set<string>(), rows: BrokerDelivery[] = [], stillOpen: string[] = [];
    const unique = [...again, ...fresh].filter(r => !seen.has(r.id) && !!seen.add(r.id));
    for (const d of rowsOf(db, unique)) {
      const st = deliveryState(d.status);
      if (st === "o") stillOpen.push(d.id);
      // new: only trouble travels (failed or open); known-open: only once it finished
      if (wasOpen.has(d.id) ? st !== "o" : st !== "c") rows.push(d);
    }
    return { rows, maxRow, open: stillOpen.slice(-400) };
  } catch { return { rows: [], maxRow: after, open }; }
}
