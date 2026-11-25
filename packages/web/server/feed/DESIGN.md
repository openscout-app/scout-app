# The Feed projection

The whole pipeline, from sources to the Home page, is mapped in
[docs/eng/feed/README.md](../../../../docs/eng/feed/README.md).

The web server owns **feed.sqlite**, beside its web-state database. It is a
14-day projection, not a Scout record. Delete it to rebuild it. A restart with
a valid file can serve the last committed rows before the runtime or GitHub
answers. A missing file or a different SQLite `user_version` (the format
version) starts an empty projection. No migrations or archive. The only store
is SQLite, opened with `bun:sqlite`. WAL lets readers keep their current
snapshot while a writer commits. There is no Redis, message bus, or second
file format.

## What gets written

| Column | Meaning |
| --- | --- |
| `id` | `<host>:thread:<session>` across turns; `<host>:work:<id>` without session evidence; `<host>:post:<id>` for a standalone publication. Running and quota slot IDs carry the same host prefix. |
| `kind` | result, pr, visual, film, page, waits, post, running or quota. A PR is a reference on a thread, not a second copy of that thread. |
| `placement`, `state` | Stream, Back to you, Landed or For you eligibility; current work or settlement state. A removed post keeps only the identity and change information needed for a delta. |
| `title`, `caption`, `refs` | Outcome, short ask, and structured references. No HTML or link surgery on a list read. |
| `at`, `day`, `updated_seq` | Finish time, 4am working day, and last change for the public cursor. |
| Other columns | List presentation, ranking inputs, expanded detail, summary and its evidence, allowed asset references. Reading heads does not fetch detail or evidence. |

`inputs` holds the bounded enriched tasks and agent publications needed to
update those slots after a restart. `pull_facts` holds the PR metadata used by
the writer and by the existing picture/diff routes. Neither is authoritative.
`meta` holds the committed source watermark, the local sequence, and the origin
host. The origin is the **projecting runtime’s stable node ID** from
`GET /v1/node`, not a hostname, display name or publication author. It is
escaped as one ID segment. Thus two hosts can project `thread:s` without
colliding, and actions can still refer to the unchanged runtime work IDs.
A valid file can serve reads offline. Before writing, the process verifies the
origin; if a file was copied from another host, it discards its rows and marks
and rebuilds. Missing identity postpones writing; it never mints a “local” ID.

## Operator actions belong to the runtime

A Feed slot can expire; an operator action does not expire with it. Replies,
reactions, answers and attention dismissals go to the runtime first. There is
no Feed command that sets a review flag, saves a reaction or dismisses a slot.
The `reviewed` column is a query index: it copies the presence of an operator
line from the runtime conversation, or of a move receipt after the turn
("The latest move" below), not the fact that someone opened the row.
The runtime attention queue determines whether a request is still waiting.
A removal used to serve deltas is not a dismissal.

Feed reactions are directions sent as messages, not emoji counters. Keyed
web session replies use the runtime delivery API: even an in-place submission
returns a recorded message. A failed or uncertain submission never falls back
to typing directly. Successor tasks and attention decisions already use
runtime commands. The existing local “seen” marker for opening a Home row is
a display preference, not a cross-device review or dismissal.

### The latest move

A post says what the operator last did on it from the Feed or Home: a reply,
a reaction, Ship it or Push it, a decision, a follow-up, Done or Drop, or a
question to Scoutbot. Many of these leave no runtime fact tied to the post: a
reaction typed into a session, a follow-up task, a Scoutbot answer. So once
the move goes through, the client posts a receipt (`POST /api/feed/moves`).
The web server keeps the newest one per post in web-state.sqlite
(`feed_moves`, `../feed/moves.ts`), beside the hides. The writer folds it into
the post's `move`, and the move is part of the thread's input signature. The
post therefore changes, and every reader gets it in its next delta, even when
the work itself did not change. The receipt outlives a restart and a deleted
feed.sqlite.

A move after the turn finished answers that turn: the turn leaves Back to you
and counts as reviewed, on every device. A newer turn waits again. A question
to Scoutbot is not a move on the work and answers nothing. The receipt is
still not a command: the move itself already went to the runtime or to
Scoutbot, and a receipt that fails to save costs only the line on the post.

The rebuild test writes an operator message to a separate runtime fixture.
It checks the Reviewed view, the operator’s words and the Home placements
after a changed-record read, a rebuild from scratch and a format reset. Even
after the slot ages out, the source message and dismissed request remain.

## Writers

1. One timer polls changed runtime records, GitHub, posts, attention and expiry.
   The next pass is scheduled 30 seconds after the previous one finishes;
   there are no overlapping polls or event subscriptions. Home need not be open.
2. The first pass uses the window query in `../db/feed.ts`. Later passes read
   changed records and conversations since the **committed** mark, with a
   short overlap. The existing background read worker runs the readonly
   runtime query. Shows, file checks and outside lookups run before the write
   transaction. The agent-post reader starts at its persisted publication mark.
3. A task and its covered publications form one input; an uncovered post gets
   its own slot. Finished turns of a session update one thread. Its newest
   finished turn leads, older turns appear in detail as “N more updates.”
   Duplicate records for the same final message do not inflate that count.
   An active turn also goes on the live channel. Legacy work without a
   session may lose hand-back eligibility to newer work in its conversation;
   a conversation alone never joins threads.
4. `project.ts`, `post.ts` and `slots.ts` reduce those inputs and current PR,
   attention and branch facts. A thread's input signature skips unrelated
   edits. The same SQLite transaction upserts slots, marks removed slots,
   expires inputs and advances the watermark. A failed transaction is retried
   from the previous mark. The shared PR list supplies branch matches. For
   named PRs it misses, the writer batches lookups by repository and number.
   A listing timeout is not an unmerge: keep last-known facts.
5. Text is produced here. A kept turn summary's gist is the title. If its
   evidence changed, only the **gist of that same final reply** can carry
   forward as a title, never as a current summary, decision or next action.
   With no gist, use a current presentation, the author's publication, the
   recorded reply, or a known PR title. With no outcome, say so. The original ask is the small line; a
   standalone agent post keeps its own words instead. Rebuilds and page reads
   never queue a turn summary. (A For you read can queue a classify or
   digest call, but it never waits for one.) A new finished reply can use the existing bounded
   subscription queue; its completion updates the slot only if the evidence
   still matches.
6. A hand-back whose own PRs merged moves to Landed; closed, superseded and
   running turns do not wait in Back to you. A current summary can also settle
   a hand-back. A matched open attention request takes the For you slot.
   Quota crossings use the same table but keep their existing source payload.
   Canvas is not a ranked post. Slack conversations are a separate connected
   source, not copies of Scout work.

## Reads

The existing client polls as before. List, Home, live and normalized slot
reads use the same per-host committed sequence (`version`). Send it back as
`since`; an unchanged sequence returns an empty **304** with
`x-feed-version`. Readers do not subscribe to anything for this projection.

- **All / Reviewed:** select the page by working-day cursor and
  `ORDER BY at DESC, id`. Rank the small candidate rows with `score.ts`.
  Up to three picks per day; other heads are in the fold. The last page has a
  null cursor. Paging never goes back to the runtime.
- **Home:** read today, yesterday and open steering requests. Place steering
  first, then Back to you and merged work newest-first, then up to four
  ranked highlights without repeating a represented session. `shipped` is
  the existing wire name for the merged Landed rows.
- **Changes:** `updated_seq > since` selects changed heads; `state='removed'`
  supplies removed IDs. When rank inputs change, the affected day's heads are
  invalidated so their read-time selection flags stay consistent. An unchanged
  cursor gets 304. After a format reset or expiry of removal information, send
  a full snapshot. An All delta includes changes to older pages as well.
  A changed Home shortlist always carries all its heads; the writer marks rows
  that leave the shortlist at the working-day boundary.
- **Detail / live / sources:** direct reads by slot or kind. The detail route
  still loads the per-file diff on expansion; assets still use the existing
  file checks. The `debug=rank` option returns selection reasons, not new
  stored content. Following stays empty until the runtime records follows.

### Pulling slots on one host

`GET /api/feed/slots` returns `{origin_host, version, full, slots}` with all
live slots in the 14-day window, including running and quota. It has no Home
ranking or page cut. `GET /api/feed/slots?since=<version>` returns every row
with `updated_seq > since`, in `updated_seq, id` order, including
`state="removed"` rows. A single transaction can change several rows with
the same sequence: consume the entire batch before saving its `version`.
A cursor older than retained removals or from a discarded format gets
`full: true`: replace that host's copy, rather than merging the snapshot as
a delta. A cursor is per origin; never compare two hosts' sequences. No
collector, central server, replication transport or cross-host ordering is
implemented here.
