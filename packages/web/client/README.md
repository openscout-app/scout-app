# Feed client

For the standalone preview, run the [root startup command](../../../README.md#start-the-preview). The contract below describes what a full host can supply. The preview mounts the read-only Feed and Chat routes, omits write controls, and uses polling.

Import `NativeAreaScreen` from the `scout-preview-feed-client` workspace package to mount the same Feed as the standalone preview. It renders `FeedContent → FeedStream → FeedItem`. The package exports `scoutSurface`, the surface description for `/embed/feed` (profile `macos.feed`). The client reads the local runtime. It does not bundle posts, start a server, register a host route, or open a WebView.

## Mount it

Link the Feed as a source workspace. Keep `packages/web/client` and `packages/web/shared` together so the package can resolve the API contracts. Have the local shell serve its React entry at `/embed/feed` on the **same origin** as the API. Use the shell's React 19 runtime once for both the root and these components. With a router, pass its navigation function as the fallback:

```tsx
import type { ComponentProps } from "react";
import { NativeAreaScreen } from "scout-preview-feed-client";
import { routeEmbeddedNavigation } from "scout-preview-feed-client/embed-navigation";
import "scout-preview-feed-client/theme.css";

export function FeedPage({ navigate, theme }: {
  navigate: ComponentProps<typeof NativeAreaScreen>["navigate"];
  theme: "light" | "dark";
}) {
  return (
    <div className="scout-feed-embed" data-scout-theme={theme}>
      <NativeAreaScreen
        capabilities={{ readOnly: false }}
        navigate={route => routeEmbeddedNavigation(route, navigate)}
      />
    </div>
  );
}
```

Give the mount a height. The optional stylesheet supplies the Feed's spacing, type and base palettes in the wrapper; omit it if the host already supplies Scout theme tokens. Keep the stream and its lightbox under the same `div[data-scout-theme]`. Bundle the component CSS imports with the JS.

The native bridge receives `{ kind: "ui-action", action: { type: "navigate", route } }`. Without that bridge, the shell owns the destinations: `/c/:conversationId`, `/sessions/:sessionId`, and `/work/:workId`. “Copy a link to this post” uses `/?post=:id`; the receiving Home route must pass that id as `FeedStream.expand`. The standalone native Feed is not the Home stream: leave its own scrolling and undo toast enabled.

## Mount it in the shell

`scout-preview-feed-client/shell` exports `AppShell`, `SCOUT_SURFACES`, the `ScoutSurface` type, `ScoutApp` and `FeedCapabilitiesProvider`. `<AppShell mode="embed">` renders the same theme wrapper as the snippet above and nothing else. `<AppShell mode="app">` adds the Scout frame: a 260px sidebar with the five surfaces (Feed live; Chat, Sessions, Board and Control planned) and the theme row, a 40px top row with the page name and a sidebar toggle, the page as a rounded sheet, and a 28px status bar with the runtime status. `ScoutApp` maps a URL to the right mode: `/` and `/<surface>` open the app, `/embed/feed` opens the chrome-free Feed.

## Set capabilities

`NativeAreaScreen`, `FeedContent`, and `FeedStream` accept `capabilities?: Partial<FeedCapabilities>`. To set capabilities for a subtree, wrap it in `<FeedCapabilitiesProvider capabilities={…}>`. Components in the subtree, including standalone `FeedItem` instances, read the merged settings through `useFeedCapabilities()`.

- Set `readOnly: false` for contextual actions and live event subscriptions. The host supplies its authorized routes and source data.
- Set `readOnly: true` for recorded Chat and session links, no write controls, and polling instead of WebSockets. The server must still enforce read-only access and decide which source data to return.
- A read-only stream shows the Scout handoff after its first successful load, unless `embedded` is set. Pass `handoff: { label, href, detail? }` to replace the link and text, or `handoff: null` to hide it.

Omitted settings come from the nearest provider. Without a provider, `readOnly` defaults to the legacy `__SCOUT_FEED_READ_ONLY__` build flag. If the flag is absent, the default is `true` only when the process environment sets `SCOUT_FEED_READ_ONLY=1`. The standalone launcher passes `readOnly: true` at runtime and needs no Feed-specific build flag.

Use `FeedContent` to mount the Feed without the native title hook. Use `FeedStream` if the host already reads the source data or needs fixed placements (typed as `FeedSlot`).

## Local service contract

| Feature | Host dependency |
| --- | --- |
| Stream | `GET /api/feed?view=all\|reviewed`. Supply the production heads and day groups in `../shared/api/feed.ts`. Older pages use `cursor`; refresh uses `since` and accepts HTTP 304. A failed first read shows a retry state, not an empty feed. |
| Source posts and media | `GET /api/feed/sources` for activity, outside threads, and quota warnings (contract: `../shared/api/feed-sources.ts`); `GET /api/feed/summaries?posts=…` for batched summaries; `GET /api/feed/live?since=…` for visible live leads. Serve the asset and page URLs the heads return. No media or outside conversations ship with the client. |
| Expanded item | `GET /api/feed/post/:id`, then `GET /api/session-ref/:ref` if there is an owner session. Commit diffs use `GET /api/repo-diff/worktree` with the checkout, branch layer, base and compare refs, patch tier and cache preference. Trace previews are the fallback. |
| Discussion | Opening the thread is navigation, not a new write. Reply/React can send `POST /api/sessions/reply` with the session id, body and client message id. A successor sends `POST /api/work/:id/continue` with body and request id. “Ask about this” uses `POST /api/scoutbot/artifact-ask`: Scoutbot answers from the post, not by interrupting its owner. |
| Moves and undo | `POST /api/work/:id/move` returns an applied/refused decision. `POST /api/feed/moves` records a completed action. Hide posts to `/api/feed/hides` with the id and time; undo deletes `/api/feed/hides?id=…`. Keep writes on the authorized local runtime and return its real decisions. |
| Refresh and auth | Same-origin tRPC WebSockets: `control.events` at `/ws/events`, `tail.events` at `/ws/tail` for open session detail. The stream retains its production polling fallback. The JSON client retries a 401 once after a successful bootstrap read (`/api/bootstrap.js` by default). |
| Reply dictation | The mic probes `/api/voice/health`, engages capture, and starts capture with `POST /api/voice/session` and uses its events, stop and cancel routes, or browser audio with `/api/voice/transcribe`. The permission/settings fallback is in `lib/scout-voice.ts`. Typed replies do not require voice. |

The client imports four application contracts from `../shared/api/`: `feed.ts`, `feed-discussion.ts`, `feed-moves.ts`, and `feed-sources.ts`. React, React DOM, Lucide, the tRPC client and the public Scout protocol package are pinned by this workspace manifest and the repository lockfile. The client uses the local transport, not paired-host transports, a hosted console, or another screen's router.

## Check without a running app

From this directory:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
bun run test
out="$(mktemp -d)"
bun build ./screens/feed/index.ts --target browser --format esm --outdir "$out"
ls "$out"
rm -r "$out"
```

The build emits `index.js` and `index.css`. The browser bundle needs no `process` global or build defines. To mount the Feed inside a React host, import the package in the host's build so the components share its React runtime.

The tests load the browser module without a `process` global and render both capability modes against intercepted HTTP requests. They neither read a recorded feed nor send a real message.
