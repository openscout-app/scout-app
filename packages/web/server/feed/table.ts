import { showAsset } from "./leads.ts";
import { namedRepos, pullRefs, type PullRef } from "./feed-refs.ts";
import type {
  FeedHome,
  FeedLive,
  FeedPostDetail,
  FeedPostHead,
  FeedRank,
  FeedResponse,
  FeedSize,
  FeedViewId,
  WebFeedPull,
  WebFeedTask,
} from "../../shared/api/feed.ts";
import type { ActivityPost } from "./activity.ts";
import { placePosts, taskFromPost, type RuntimePost } from "./agent-posts.ts";
import { dayKey, dayStart, previousDay } from "./days.ts";
import { type Slot, runningSlot, threadSignature, finishedSlot } from "./slots.ts";
import { emptyContext, projectThreads, type FeedContext } from "./project.ts";
import { hiddenBy } from "../../shared/api/feed-hides.ts";
import { openFeed } from "./schema.ts";
import { homeSlots, rankDays, type RankedSlot, type SlotRank } from "./views.ts";

export const FEED_WINDOW_MS = 14 * 86_400_000;
const json = JSON.stringify;
type Change = {
  upsert?: readonly WebFeedTask[];
  remove?: readonly string[];
  posts?: readonly RuntimePost[];
  context?: Partial<FeedContext>;
  mark?: number;
  expireBefore?: number;
};
type HeadRow = Pick<Slot, "id" | "at" | "day" | "title" | "caption" | "refs" | "head" | "placement"> & {
  updated_seq: number;
};
function headOf(row: HeadRow, selected = false): FeedPostHead {
  return {
    ...JSON.parse(row.head),
    id: row.id,
    at: row.at,
    day: row.day,
    title: row.title,
    caption: row.caption,
    prs: JSON.parse(row.refs),
    backToYou: row.placement === "back_to_you",
    version: row.updated_seq,
    selected,
  };
}
const HEAD = "id, at, day, title, caption, refs, head, placement, updated_seq";
const POST = "state <> 'removed' AND candidate IS NOT NULL";

export class FeedTable {
  private readonly db = openFeed();
  get originHost(): string {
    const host = this.meta("origin_host");
    if (!host) throw new Error("Cannot write Feed slots without a runtime node id");
    return host;
  }

  /** Bind writes to the projecting runtime, never an address, display name or random fallback. */
  bindOrigin(value: string) {
    const host = value.trim();
    if (!host) throw new Error("The runtime returned an empty node id");
    this.db.transaction(() => {
      const prior = this.meta("origin_host");
      if (prior === host) return;
      if (prior) {
        // Never keep slots if the configured runtime now has a different identity.
        const epoch = Math.max(this.version + 1, Date.now() * 1024);
        this.db.exec("DELETE FROM feed_slots; DELETE FROM inputs; DELETE FROM pull_facts; DELETE FROM meta");
        this.set("floor", epoch);
        this.set("seq", epoch);
      }
      this.set("origin_host", host);
    })();
  }
  close() {
    this.db.close();
  }

  private meta(key: string) {
    return this.db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key=?").get(key)?.value;
  }
  private set(key: string, value: string | number) {
    this.db.query("INSERT OR REPLACE INTO meta VALUES (?, ?)").run(key, String(value));
  }
  get version() {
    return Number(this.meta("seq"));
  }
  get mark() {
    const m = this.meta("mark");
    return m == null ? null : Number(m);
  }
  get context(): FeedContext {
    const pulls = this.db
      .query<{ payload: string }, []>("SELECT payload FROM pull_facts ORDER BY key")
      .all()
      .map((r) => JSON.parse(r.payload) as WebFeedPull);
    return { ...emptyContext, ...JSON.parse(this.meta("context") ?? "{}"), pulls };
  }
  get postMark() {
    return (
      this.db.query<{ at: number | null }, []>("SELECT MAX(at) AS at FROM inputs WHERE source='post'").get()?.at ?? 0
    );
  }
  private inputs<T>(source: string): T[] {
    return this.db
      .query<{ payload: string }, [string]>("SELECT payload FROM inputs WHERE source=? ORDER BY id")
      .all(source)
      .map((row) => JSON.parse(row.payload));
  }
  namedInputs(since: number): Map<string, { root: string | null; repos: string[]; refs: PullRef[] }> {
    return new Map(
      this.db
        .query<{ id: string; root: string | null; repos: string; refs: string }, [number]>(
          "SELECT id, json_extract(payload,'$.projectRoot') AS root, repos, refs FROM inputs WHERE source='task' AND at>=?",
        )
        .all(since)
        .map((row) => [row.id, { root: row.root, repos: JSON.parse(row.repos), refs: JSON.parse(row.refs) }]),
    );
  }

  private putSlot(row: Slot, inputKey: string, next: number) {
    const columns = Object.keys(row) as (keyof Slot)[];
    const values = columns.map((k) => row[k]);
    const sql = `INSERT INTO feed_slots(${columns.join(",")},updated_seq,input_key) VALUES(${values.map(() => "?").join(",")},?,?)
            ON CONFLICT(id) DO UPDATE SET ${columns
              .filter((k) => k !== "id")
              .map((k) => k + "=excluded." + k)
              .join(",")},updated_seq=excluded.updated_seq,input_key=excluded.input_key,removed_at=NULL
            WHERE removed_at IS NOT NULL OR ${columns
              .filter((k) => k !== "id")
              .map((k) => k + " IS NOT excluded." + k)
              .join(" OR ")}`;
    if (this.db.query(sql).run(...values, next, inputKey).changes) return true;
    this.db.query("UPDATE feed_slots SET input_key=? WHERE id=? AND input_key<>?").run(inputKey, row.id, inputKey);
    return false;
  }

  /** The only write path. Advance the runtime watermark in the same commit as its slots. */
  apply(change: Change) {
    return this.db
      .transaction(() => {
        const origin = this.originHost;
        const next = this.version + 1;
        const changed: string[] = [],
          removed: string[] = [];
        const before = change.expireBefore ?? 0;
        let edits = this.db.query("DELETE FROM inputs WHERE at < ?").run(before).changes;
        for (const id of change.remove ?? [])
          edits += this.db.query("DELETE FROM inputs WHERE source='task' AND id=?").run(id).changes;
        const put = this.db.query(`INSERT INTO inputs(source,id,at,payload,repos,refs) VALUES(?,?,?,?,?,?)
        ON CONFLICT(source,id) DO UPDATE SET at=excluded.at,payload=excluded.payload,repos=excluded.repos,refs=excluded.refs WHERE payload<>excluded.payload`);
        for (const t of change.upsert ?? []) {
          const at = t.state === "working" ? t.updatedAt : t.finishedAt;
          if (at < before) continue;
          const words = t.title + "\n" + (t.reply ?? "");
          const wrote = put.run("task", t.id, at, json(t), json(namedRepos(words)), json(pullRefs(words))).changes;
          edits += wrote;
        }
        for (const p of change.posts ?? [])
          if (p.createdAt >= before) edits += put.run("post", p.id, p.createdAt, json(p), "[]", "[]").changes;
        const ctx = { ...this.context, ...change.context };
        const { pulls, ...settings } = ctx;
        const contextText = json(settings);
        if (contextText !== this.meta("context")) {
          this.set("context", contextText);
          edits++;
        }
        if (change.context?.pulls) {
          const putPull = this.db.query(
            "INSERT INTO pull_facts VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload WHERE payload<>excluded.payload",
          );
          for (const pull of pulls) edits += putPull.run(pull.key, json(pull)).changes;
          edits += this.db
            .query("DELETE FROM pull_facts WHERE key NOT IN (SELECT value FROM json_each(?))")
            .run(json(pulls.map((p) => p.key))).changes;
        }

        if (edits) {
          const placed = placePosts(this.inputs<WebFeedTask>("task"), this.inputs<RuntimePost>("post"));
          const { threads, current, postContext, aliases } = projectThreads(
            origin,
            [...placed.tasks, ...placed.alone.map(taskFromPost)],
            ctx,
          );
          const prior = new Map(
            this.db
              .query<{ id: string; input_key: string; day: string; candidate: string | null }, []>(
                "SELECT id,input_key,day,candidate FROM feed_slots WHERE state <> 'removed' AND kind <> 'quota'",
              )
              .all()
              .map((r) => [r.id, r]),
          );
          const rerank = new Set<string>();
          const pageKeys = () =>
            this.db
              .query<{ day: string }, []>(`SELECT DISTINCT day FROM feed_slots WHERE ${POST} ORDER BY day DESC LIMIT 7`)
              .all()
              .map((r) => r.day);
          const previousPage = new Set(pageKeys());
          const hides = new Map(ctx.hides.map((h) => [h.id, h.at]));
          const moves = new Map((ctx.moves ?? []).map((m) => [m.id, m]));
          // A thread that joined a promoted session id keeps the newest hide and move made under its earlier ids.
          for (const [id, earlier] of aliases) {
            for (const alias of earlier) {
              const hid = hides.get(alias);
              if (hid !== undefined && hid > (hides.get(id) ?? -Infinity)) hides.set(id, hid);
              const move = moves.get(alias);
              if (move && move.at > (moves.get(id)?.at ?? -Infinity)) moves.set(id, { ...move, id });
            }
          }
          const upsert = (row: Slot, key: string) => {
            if (this.putSlot(row, key, next)) changed.push(row.id);
          };
          for (const [id, thread] of threads) {
            const held = prior.get(id);
            const finished = thread.some((t) => t.state !== "working");
            if (finished) prior.delete(id);
            for (const t of thread.filter((t) => t.state === "working")) {
              const row = runningSlot(origin, t, finished ? id : null);
              prior.delete(row.id);
              upsert(row, "");
            }
            if (!finished) continue;
            // A hidden thread leaves like any removed slot, so every reader drops it on its next delta;
            // it is written again once it has something newer than the hide, or the hide is undone.
            if (hides.has(id) && hiddenBy(hides, id, finishedSlot(thread, postContext, current).at)) {
              if (held) prior.set(id, held);
              continue;
            }
            const move = moves.get(id) ?? null;
            const signature = threadSignature(thread, postContext, current, move);
            if (held?.input_key === signature) continue;
            const row = finishedSlot(thread, postContext, current, move);
            if (held?.candidate !== row.candidate || held?.day !== row.day) {
              rerank.add(row.day);
              if (held?.candidate) rerank.add(held.day);
            }
            upsert(row, signature);
          }
          for (const [id, old] of prior) {
            if (old.candidate) rerank.add(old.day);
            this.db
              .query(
                `UPDATE feed_slots SET state='removed', updated_seq=?, removed_at=?, title='', caption=NULL, refs='[]',
            head=NULL, detail=NULL, candidate=NULL, files=NULL WHERE id=?`,
              )
              .run(next, change.mark ?? Date.now(), id);
            removed.push(id);
          }
          // selected is a read-time fact on the public head. When the inputs to
          // a day's order move, a delta must carry its peers' selected flags too.
          // A day promoted onto page one may be entirely new to the reader.
          for (const day of pageKeys()) if (!previousPage.has(day)) rerank.add(day);
          if (rerank.size)
            this.db
              .query(`UPDATE feed_slots SET updated_seq=? WHERE ${POST} AND day IN (SELECT value FROM json_each(?))`)
              .run(next, json([...rerank]));
        }
        const lastMark = this.mark;
        const dayRolled = change.mark != null && lastMark !== null && dayKey(lastMark) !== dayKey(change.mark);
        // Home changes without new work when yesterday falls out of its shortlist.
        // Mark the affected rows on the normal writer tick; every view can then
        // use the same persisted sequence instead of a separate, time-based token.
        const outgoing = dayRolled
          ? this.db
              .query(`UPDATE feed_slots SET updated_seq=? WHERE ${POST} AND day>=? AND day<? AND placement<>'for_you'`)
              .run(next, previousDay(dayKey(lastMark!)), previousDay(dayKey(change.mark!))).changes
          : 0;
        if (changed.length || removed.length || outgoing) this.set("seq", next);
        // Removals themselves expire. Clients predating a discarded removal restart from a snapshot.
        const floor = this.db
          .query<
            { seq: number | null },
            [number]
          >("SELECT max(updated_seq) AS seq FROM feed_slots WHERE removed_at < ?")
          .get(before)?.seq;
        if (floor) {
          this.set("floor", Math.max(floor, Number(this.meta("floor"))));
          this.db.query("DELETE FROM feed_slots WHERE removed_at < ?").run(before);
        }
        if (change.mark != null) this.set("mark", change.mark);
        return { changed: changed.sort(), removed: removed.sort() };
      })
      .immediate();
  }

  head(id: string) {
    const row = this.db.query<HeadRow, [string]>(`SELECT ${HEAD} FROM feed_slots WHERE id=? AND ${POST}`).get(id);
    return row ? headOf(row) : null;
  }
  detail(id: string): Omit<FeedPostDetail, "diff"> | null {
    const row = this.db
      .query<
        { detail: string; updated_seq: number },
        [string]
      >(`SELECT detail,updated_seq FROM feed_slots WHERE id=? AND ${POST}`)
      .get(id);
    return row ? { ...JSON.parse(row.detail), version: row.updated_seq } : null;
  }
  /** Only references on a current Feed row may be used for a secondary read. */
  hasConversation(id: string): boolean {
    return Boolean(this.db.query(`SELECT 1 FROM feed_slots WHERE ${POST}
      AND json_extract(head,'$.conversationId')=? LIMIT 1`).get(id));
  }
  /** The final reply recorded on this work's invocation, never the last message by its author. */
  sourceTurn(workId: string, conversationId: string) {
    return this.db.query<{ replyId: string | null; ownerId: string | null }, [string,string]>(`
      SELECT json_extract(payload,'$.replyId') AS replyId, json_extract(payload,'$.ownerId') AS ownerId
      FROM inputs WHERE source='task' AND id=? AND json_extract(payload,'$.conversationId')=?`).get(workId,conversationId);
  }
  sessionOwners(id: string) {
    return this.db.query<{ harness: string | null; agentId: string | null }, [string]>(`SELECT DISTINCT
      json_extract(head,'$.agent.harness') AS harness, json_extract(head,'$.owner.agentId') AS agentId
      FROM feed_slots WHERE ${POST} AND json_extract(head,'$.owner.sessionId')=?`).all(id);
  }
  hasShow(id: string): boolean {
    return Boolean(this.db.query(`SELECT 1 FROM feed_slots,json_each(detail,'$.leads') AS lead
      WHERE ${POST} AND json_extract(lead.value,'$.ref.source')='show'
      AND json_extract(lead.value,'$.ref.asset')=? LIMIT 1`).get(showAsset(id)));
  }
  file(id: string) {
    return (
      this.db
        .query<
          { path: string },
          [string]
        >("SELECT f.value AS path FROM feed_slots,json_each(files) AS f WHERE f.key=? LIMIT 1")
        .get(id)?.path ?? null
    );
  }
  size(): FeedSize {
    return this.db
      .query<
        FeedSize,
        []
      >(`SELECT count(*) AS posts,count(distinct day) AS days,coalesce(sum(reviewed),0) AS reviewed FROM feed_slots WHERE ${POST}`)
      .get()!;
  }
  activityPosts(): ActivityPost[] {
    return this.db
      .query<
        ActivityPost,
        []
      >(`SELECT day,json_extract(head,'$.project') AS project,json_extract(head,'$.agent.harness') AS harness FROM feed_slots WHERE ${POST}`)
      .all();
  }
  live(since: number | null): FeedLive | null {
    const version = this.version;
    return since === version
      ? null
      : {
          version,
          sessions: this.db
            .query<{ head: string; updated_seq: number }, []>(
              "SELECT head,updated_seq FROM feed_slots WHERE kind='running' AND state<>'removed' ORDER BY at DESC,id",
            )
            .all()
            .map((r) => ({ ...JSON.parse(r.head), version: r.updated_seq })),
        };
  }

  /** Pull the normalized slots from this host, independent of Home and day pagination.
   * A commit shares one sequence across its rows. Return the whole commit, not a partial page. */
  pullSlots(since: number | null, now: number) {
    return this.db.transaction(() => {
      const version = this.version;
      if (since === version) return null;
      const full = since === null || since < Number(this.meta("floor")) || since > version;
      const cols = "id,kind,placement,state,title,caption,refs,at,reviewed,updated_seq";
      type Pulled = Pick<
        Slot,
        "id" | "kind" | "placement" | "state" | "title" | "caption" | "refs" | "at" | "reviewed"
      > & {
        updated_seq: number;
      };
      const rows = full
        ? this.db
            .query<
              Pulled,
              [number]
            >(`SELECT ${cols} FROM feed_slots WHERE state<>'removed' AND at>=? ORDER BY updated_seq,id`)
            .all(now - FEED_WINDOW_MS)
        : this.db
            .query<Pulled, [number]>(`SELECT ${cols} FROM feed_slots WHERE updated_seq > ? ORDER BY updated_seq,id`)
            .all(since!);
      return {
        origin_host: this.originHost,
        version,
        full,
        slots: rows.map((r) => ({
          ...r,
          reviewed: r.state !== "removed" && Boolean(r.reviewed),
          refs: JSON.parse(r.refs) as unknown,
        })),
      };
    })();
  }

  response(
    view: FeedViewId,
    opts: { since?: number | null; cursor?: string | null; now: number; pageDays?: number; debug?: boolean },
  ): FeedResponse | null {
    const { now } = opts;
    const since = opts.debug || opts.cursor ? null : (opts.since ?? null);
    const version = this.version;
    if (since === version) return null;
    const full = since === null || since > version || since < Number(this.meta("floor")) || view === "home";
    const until = opts.cursor ? dayStart(opts.cursor) : Number.MAX_SAFE_INTEGER;
    const pageSize = opts.pageDays ?? 7;
    const start = now - FEED_WINDOW_MS;
    const keys = this.db
      .query<{ day: string }, [number, number, number]>(
        `SELECT DISTINCT day FROM feed_slots
      WHERE ${POST} AND at>=? AND at<? ORDER BY day DESC LIMIT ?`,
      )
      .all(start, until, pageSize + 1)
      .map((r) => r.day);
    const page = keys.slice(0, pageSize);
    const pageSet = new Set(page);
    // A reader may already hold older pages. The All delta cannot acknowledge
    // a sequence without returning a changed post just because its day is folded.
    const rankPage =
      view === "all" && !full
        ? [
            ...new Set([
              ...page,
              ...this.db
                .query<{ day: string }, [number, number]>(
                  `SELECT DISTINCT day FROM feed_slots WHERE updated_seq>? AND ${POST} AND at>=?`,
                )
                .all(since!, start)
                .map((r) => r.day),
            ]),
          ]
        : page;
    const columns = "id,at,day,reviewed,state,placement,candidate";
    const rankRows =
      view === "home"
        ? this.db
            .query<SlotRank, [number, string]>(
              `SELECT ${columns} FROM feed_slots WHERE ${POST}
          AND at>=? AND (day>=? OR placement='for_you') ORDER BY at DESC,id`,
            )
            .all(start, previousDay(dayKey(now)))
        : this.db
            .query<SlotRank, [number, number, string]>(
              `SELECT ${columns} FROM feed_slots WHERE ${POST}
          AND at>=? AND at<? AND day IN (SELECT value FROM json_each(?)) ORDER BY at DESC,id`,
            )
            .all(start, until, json(rankPage));
    const rows: RankedSlot[] = rankRows.map((r) => ({ ...r, candidate: JSON.parse(r.candidate) }));
    const ranking: Record<string, FeedRank> = {};
    const allDays = rankDays(rows, opts.debug ? ranking : undefined);
    const keep = new Set(
      rows.filter((r) => view !== "following" && (view !== "reviewed" || r.reviewed)).map((r) => r.id),
    );
    const days =
      view === "home"
        ? []
        : allDays
            .filter((d) => pageSet.has(d.day))
            .map((d) => ({
              ...d,
              ids: d.ids.filter((id) => keep.has(id)),
              folded: d.folded.filter((id) => keep.has(id)),
            }))
            .filter((d) => d.ids.length || d.folded.length);
    const home = view === "home" ? homeSlots(rows, now, opts.debug ? ranking : undefined) : null;
    const ids = home ? Object.values(home).flat() : days.flatMap((d) => [...d.ids, ...d.folded]);
    if (rankPage.length > page.length) ids.push(...rows.filter((r) => !pageSet.has(r.day)).map((r) => r.id));
    const selected = new Set(allDays.flatMap((d) => d.ids));
    const read = this.db
      .query<
        HeadRow,
        [string, number]
      >(`SELECT ${HEAD} FROM feed_slots WHERE id IN (SELECT value FROM json_each(?)) AND updated_seq > ?`)
      .all(json(ids), full ? -1 : since!);
    const heads = new Map(read.map((r) => [r.id, headOf(r, selected.has(r.id))]));
    const removed = full
      ? []
      : this.db
          .query<{ id: string }, [number]>(
            "SELECT id FROM feed_slots WHERE updated_seq > ? AND state='removed' AND kind NOT IN ('running','quota') ORDER BY id",
          )
          .all(since!)
          .map((r) => r.id);
    return {
      view,
      version,
      generatedAt: now,
      full,
      posts: ids.flatMap((id) => heads.get(id) ?? []),
      removed,
      days,
      home,
      size: this.size(),
      cursor: !home && keys.length > pageSize ? keys[pageSize - 1]! : null,
      views: ["all", "reviewed", "home"],
      ...(opts.debug
        ? { ranking: Object.fromEntries(ids.filter((id) => ranking[id]).map((id) => [id, ranking[id]!])) }
        : {}),
    };
  }
  home(now: number): FeedHome {
    return this.response("home", { now })!.home!;
  }
}
