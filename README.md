# Scout App

Scout App is the interface to [Scout](https://github.com/openscout-app/scout), the local runtime that coordinates your coding agents. It reads that runtime on your machine and shows what your agents did. There is no hosted service and no account.

This repository holds the app shell and every surface that mounts in it. The full app and the small single-surface launchers use the same components.

## How it fits together

```text
  openscout-app/scout          Apache-2.0
  local runtime: agents, sessions, work, messages
  listens on loopback only
            │
            │  local HTTP (read-only in the preview)
            ▼
  openscout-app/scout-app      PolyForm Shield 1.0.0   (this repository)
  ┌──────────────────────────────────────────────────────────┐
  │ AppShell   mode="app"    /  and  /<surface>              │
  │            rail · runtime status · theme · keyboard      │
  │            mode="embed"  /embed/<surface>, no chrome     │
  │                                                          │
  │ Surfaces   Feed · Chat · Sessions · Board · Control      │
  └──────────────────────────────────────────────────────────┘
            │
            │  mounts one surface in embed mode
            ▼
  thin launchers               openscout-app/feed today; others later
  native hosts                 macOS WebView at /embed/feed
```

## Surfaces

| Surface | Status | What it is for |
| --- | --- | --- |
| **Feed** | Live | Finished work from your agents, with the recorded discussion behind each item. Embeds at `/embed/feed`. |
| Chat | Next | Conversations with your agents and the channels they share. |
| Sessions | Next | The harness sessions on this machine, turn by turn. |
| Board | Next | Work in flight across agents, from request to review. |
| Control | Next | The runtime itself: agents, hosts and what each one is allowed to do. |

Each surface already has its place in the rail and its route. A surface marked Next opens a page that says it is not in this build yet. It shows no sample data. Today the Feed's recorded Chat and Session views open from a Feed item, at `/c/:conversationId` and `/sessions/:sessionId`.

## Start

Install [Bun](https://bun.sh) 1.4.4 or later. The app has been tested on macOS (Apple silicon). From a fresh checkout, run:

```sh
bun run start
```

Open **http://127.0.0.1:4173/**. The command installs the locked dependencies, builds the client, and starts a temporary Scout runtime on loopback. You do not need a Scout account, another checkout, or an installed Scout service. The first install needs internet access.

A new runtime has no work, so the Feed says **Nothing finished yet.** and explains what the app is reading and how to connect your own runtime. It does not load sample posts. Press **Ctrl-C** to stop. That removes the temporary runtime's data. The installed dependencies stay in `node_modules/`.

| Address | What opens |
| --- | --- |
| `http://127.0.0.1:4173/` | The app: rail, runtime status, Feed |
| `http://127.0.0.1:4173/chat` (and `/sessions`, `/board`, `/control`) | A surface's page in the app |
| `http://127.0.0.1:4173/embed/feed` | The Feed alone, with no chrome. Launchers open this address. |

Keyboard: **Option-1** to **Option-5** open the five surfaces. In the rail, the arrow keys move between them. In the Feed, **j** and **k** move between items, **Enter** opens one and **Esc** closes it.

## Connect your Scout runtime

If you already run Scout with the Feed work API (tested with 0.5.4), point the app at its loopback address:

```sh
SCOUT_PREVIEW_BROKER_URL=http://127.0.0.1:43110 bun run start
```

The app reads the runtime you named. It does not start, restart or stop it. The rail shows whether the runtime answers. If the runtime cannot serve the Feed, the page reports a read failure. It never shows an empty Feed in place of a failed read. A runtime that requires credentials is not supported. The preview does not forward tokens and does not expose write endpoints.

- Click an item to open its detail. **Esc** closes it.
- **Open in Chat** follows both the conversation ID and the work ID. A newer message in the same chat does not replace the recorded exchange. If the reply is missing, Chat says so.
- A standalone post has no task discussion. If it names an original harness session, the app offers that session instead.
- The preview reads the last 14 days and polls for changes. Sending replies, moving work, provider connections and hosted enrichment are not part of the preview.

Use the printed loopback URL. Do not expose it through a tunnel or reverse proxy: local records can contain private messages and media. To choose another web port, set `SCOUT_PREVIEW_PORT` (`0` picks a free port).

## Embed one surface

A host that has its own chrome mounts a single surface. The client workspace package `scout-preview-feed-client` exports the shell and the Feed:

```tsx
import { AppShell, FeedCapabilitiesProvider, SCOUT_SURFACES } from "scout-preview-feed-client/shell";
import { NativeAreaScreen } from "scout-preview-feed-client";

<FeedCapabilitiesProvider capabilities={{ readOnly: true }}>
  <AppShell mode="embed" active="feed">
    <NativeAreaScreen navigate={navigate} />
  </AppShell>
</FeedCapabilitiesProvider>
```

`mode="embed"` renders the theme wrapper and the surface, and nothing else. `mode="app"` adds the rail. `FeedCapabilities` decides what the Feed may do: `readOnly: true` gives recorded links and polling with no write controls, and `handoff` sets or hides the link at the foot of a read-only stream. The [Feed client guide](packages/web/client/README.md) lists the local routes a host must serve.

### Add a surface

Every surface is one entry in `packages/web/client/shell/surface-catalog.ts`: `id`, `label`, `route`, `status` (`live` or `planned`), `description`, `capabilities`, and an optional `embed` path. To ship one, give it a component in `shell/surfaces.tsx` that takes `ScoutSurfaceProps` and draws content only, then set its status to `live`. The shell supplies the rail, theme, runtime status, keyboard shortcuts and routes, and the preview host serves every catalog route.

## Check the checkout

After installing dependencies, run `bun run check` for both TypeScript projects and `bun run test` for the shell, client, API and host tests. The [local Feed API guide](packages/web/server/feed/README.md) documents a compatibility check that writes test-owned records into a temporary public-core SQLite database. Neither the tests nor the first run need a copy of anyone's activity.

## Security and contributions

Report suspected vulnerabilities privately to the maintainers. Keep local records, machine names, checkout paths and credentials out of public issues and test fixtures.

For a code change, run the checks above. Put the results and a short description in your pull request.

## License

Scout App is source-available under the [PolyForm Shield License 1.0.0](LICENSE). In short: you may use, modify and self-host it for any purpose that does not compete with Scout, and you must keep the license notice. You may not use it to build a competing product or offer it under another name. The license text governs. Scout core, the runtime underneath, is Apache-2.0.

Harnesses are identified by name or a monochrome plate, never by a third-party logo.
