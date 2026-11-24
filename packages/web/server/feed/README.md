# Local Feed API

The [standalone host](../../../../scripts/preview-host.ts) already mounts this API. Run the [root startup command](../../../../README.md#start-the-preview) to use it. The defaults below apply to the adapter itself.

Mount `createFeedApi` from `../routes/feed.ts` once in the Bun server that
serves `/embed/feed`. No additional JS packages or persistent preview database
are required. Point it at the **same local Scout runtime** whose work you want
to read. The default origin is `OPENSCOUT_BROKER_URL`, or
`http://127.0.0.1:43110` when unset. Only loopback HTTP origins are accepted.

```ts
import { createFeedApi } from "./packages/web/server/routes/feed.ts";

const api = createFeedApi({ brokerUrl: "http://127.0.0.1:43110" });
// In the existing loopback server's fetch handler, before the shell fallback:
const response = await api.handle(request);
if (response) return response;
if (new URL(request.url).pathname.startsWith("/api/")) {
  return Response.json({ error: "Not available in this preview" }, { status: 404 });
}
// Serve the UI or its local navigation destination here.
// After stopping the server and draining active requests: await api.close().
```

## Data and endpoints

The source is the public core's local `GET /v1/feed/work` projection, not the
standalone item inbox, a harness log scan, or a list of sample posts. The
server reads the last 14 days one day at a time, then reads changes since its
previous watermark. It joins authored posts and shown files from `/v1/posts`,
binds slots to the node ID from `/v1/node`, and ranks and pages those slots
with the Feed engine. Reads within 30 seconds share the projection. The
in-memory SQLite tables disappear when the server closes; nothing starts or
writes to Scout.

| Local GET | Result |
| --- | --- |
| `/api/feed?view=all\|reviewed\|home` | Production `FeedResponse`: heads, ordered days, folded IDs, counts, cursor, version. `cursor` pages by day; `since` yields a delta or a bodyless 304. |
| `/api/feed/post/:encodedPostId` | `FeedPostDetail`, including the original ask, landed result, checks, and earlier updates. Missing post: 404. |
| `/api/feed/live`, `/api/feed/slots` | Versioned running sessions or unranked host slots. Both accept `since`. |
| `/api/feed/sources`, `/api/feed/summaries` | Real project activity. Outside threads are disconnected, quota events empty, and the summary model unavailable. |
| `/api/ops/canvas-file?p=show:…&as=raw`, `/api/feed/asset/:id` | Bytes for a projected image or film; supports byte ranges. Ordinary local files are off by default. Pass trusted `mediaRoots` to opt into media explicitly named by a reply. |
| `/api/messages?conversationId=…` | The source chat's messages, oldest first. `limit` and `beforeMessageId` operate within core's bounded window. With **both** `conversationId` and `workId`, read the recorded reply and its parent by exact ID instead; no search by title or author. |
| `/api/session-ref/:encodedRef` | Read-only observe data from the recorded session: a verified node/harness/native-ID tuple and up to 200 named tail events. A missing or ambiguous identity never opens a neighboring session. |

A successful read with no work is `200` with empty posts and days. An
unreachable runtime, invalid source response, or runtime without the Feed
work route is a service error, not an empty Feed. Use a public core with
`/v1/feed/work` (present in v0.5.4). This preview does not open a second
runtime's database as a fallback.

## Discussion handoff

Keep `head.id` opaque: encode the **entire** ID for the post-detail route.
Open the conversation using `head.conversationId` (`/c/:id` in the host); its
value is not the post ID. For a post in a long-running channel, pass
`head.workId` as well to open that work's recorded exchange. A standalone
publication has no synthetic conversation or task: use `head.owner.sessionId`
with `head.agent.harness` if present. For example, send the encoded
`session:<harness>:<id>` to the session-ref endpoint. Preserve missing IDs as
null; the owner's *current* session is not a fallback.

The host owns navigation, auth and any writes. This adapter does not dispatch
replies, advance read cursors, persist hides or moves, or provide dictation,
subscription models, provider connections or hosted PR enrichment. Announce
those controls as unavailable unless the host supplies their real backends.
Post detail has no external diff SHA, so this source does not request a git
patch. Do not send missing API routes to the HTML shell or report unsupported
actions as successful.

## Verify

```sh
bun test packages/web/server/routes/feed.test.ts
bun packages/web/server/feed/public-core.check.ts "$SCOUT_CORE_CHECKOUT"
```

The first command checks the HTTP contract against constructed inputs. The
second needs a dependency-installed public Scout source checkout; it writes
test-owned work, an invocation, a flight, and two messages through the public
SQLite store. It exercises the public Feed work handler over ephemeral
loopback HTTP and reads the original messages back from that store. It
removes its temporary database and never connects to a running installation.
