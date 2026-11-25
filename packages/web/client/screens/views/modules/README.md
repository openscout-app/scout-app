# View modules

A **view** is a composition: module instances on the HUD grid. Scout ships
opinionated views (Watch, Dispatch, Comms, Machines, Terminals, Terminal,
Search, Projects, and the Ops pages: Mission Control, Tail, Alerts, In
flight, Runtime, Agents); the operator adds, replaces, removes, scopes, moves and sizes
modules from there, and Reset returns a view to how it shipped. See
`../views-model.ts`. Which views are composed, being built, or still to do:
`../REBUILD.md`.

A **module** is one self-contained panel body. It reads its own data, draws
the same on any view, and knows nothing about where it sits. The view decides
placement and size; the module decides content.

## The contract (`contract.ts`)

| Field      | What it is |
|------------|------------|
| `type`     | Stable id stored in saved views. Never rename one that has shipped. |
| `title`    | Panel head. |
| `blurb`    | One line in the module library. |
| `docs`     | `shows` · `data` · `opens`: the same three facts as the file's doc block. |
| `size`     | Default cell on a 12-column grid (columns × 24px rows). Also its height when stacked on narrow screens. |
| `minSize`  | Smallest cell it still draws correctly at. Resize, fit-to-8-columns and reflow never go below it. |
| `scopes`   | Optional header pickers (`key`, `allLabel`, `useOptions` hook). Each instance keeps its own values. |
| `state`    | Config keys that are live state, not a choice (a terminal's session id): saved, never counted as a change. |
| `options`  | On/off settings (`key`, `label`, `title`, `default`) the view's Layout menu offers for each instance: "on" or "off" in `config`, cleared back at the default, so Reset restores it. Read one with `moduleOptionOn(option, config)`. |
| `maxPerView` | How many fit on one view, for a module over a singleton (the workspace deck). |
| `Component`| Gets `{ instanceId, route, navigate, config, setConfig }`. `route` is the route the view is drawn on: read it, never write it. `navigate(route, { replace: true })` rewrites the entry, for typing and toggles on the module's own route. |

A module puts a count or a few actions in its panel head with `<ModuleHead>` (ModuleHead.tsx), from inside its body. Outside a view it draws nothing, so nothing there may be the only way to do something.

## Where a view lives

A composition can be an app view: `host` names its route, and it draws there (bare `/terminal` is Terminals) through `CompositionHost`; `/views/:id` goes to it. `composedViewFor(route)` (composed-routes.ts) is the one answer to "is this route composed?": the pane, sidebar, side-rail and inspector resolvers all ask it, so a composed route never also gets the rail or inspector its panels replace. A composition can also draw on routes it does not host: every terminal deep link (`/terminal/<agent>`, a session, a herdr layout, a fresh host terminal) draws the Terminal view, whose panels follow the page's terminal; `/terminal` itself stays Terminals'. Search composes every Search URL; Projects its list and project pages; Agents its feed and Agent every agent's page; Dispatch all of /dispatch; Work's board /work/board (/work and /work/:id are a fixed page, screens/work/WorkPage.tsx, that draws the Work panels in one tabbed pane); Briefings /briefings and /briefings/:id; Requests /requests and its `?request=`; Network, Mesh Ops, Providers, Code and Repos (with /repo-diff) all of theirs, since those URLs are their selection. Ops composes Control (and bare /ops; `?sessionId=` is the wall's cursor), Tail and Alerts (their filter and follow ids), In flight (/ops/in-flight, and /ops/advisor, which it replaced; its `?plan=`), Runtime, Agents, Lanes (`?sessionId=` is its lane) and World (its `?source=` and `?data=`), under the Ops strip (`OpsFrame`); the floor (/ops/fleet) keeps its screen, and /embed/ops never asks, so the native World keeps the full screen. Sessions composes /sessions, /sessions/:ref and /flights/:id/observe: the path's session, `?machineId=` and a flight's `?session=` and `?compare=` are what the Session board and Session thread follow. Ops › Cockpit (/ops/cockpit) composes Home's old grid under its old view id `home`: its panels follow the page's `?machineId=`. / (and the legacy /fleet) and /embed/home are the front page (screens/home/front-page), which is not composed but owns its sides like a composition (`pageOwnsSides`); basic web draws the old grid. Other deep links (/agent/:conversationId) keep their own full-bleed screens until they are composed too. /follow/* stays a full-bleed resolver: it replaces itself with the page a receipt's ids resolve to, so every receipt link (`followUrl`, `links.tail`, `links.session`, `links.work`) lands on a real page and Back skips it. The embeds (/embed/*) draw their screens themselves and never ask.

## Screens as modules

A view rebuilt from an existing screen (Terminals, Search, Dispatch, Projects,
Repos, Code, Work, Agents, Network, Mesh Ops, Providers, Ops) keeps
everything the screen did. These rules are how:

- **The URL wins on its own route.** A composition hosted on a screen's route
  draws there, so deep links, Back and Forward, and Scoutbot routes keep working.
  On that route a module reads its selection and filters from `props.route` and
  changes them with `navigate` (`{ replace: true }` for typing and toggles). Anywhere
  else it keeps them in `config` and never moves the page. Check which case
  applies with the route's `view` (`route.view === "search"`), as
  terminal-workspace does.
- **Following the page.** A scope that names `followsPage` ("This page's
  project") offers `@route` (`FOLLOW_PAGE`, follow-page.ts). A module resolves it with
  `scopeValue(config.project, route.projectSlug)`. A shipped view sets its
  panels to `@route` so they track one selection. An operator can pin any
  panel to a fixed choice instead.
- **Keys.** On its own route a wrapped screen keeps its screen-level keys.
  Anywhere else its keys bind only while focus is inside its panel:
  `usePanelKeyScope()` returns a `root` ref and a `keyScope` function for the
  screen to check against (panel-scope.ts).
- **Size by the panel, not the window.** A panel body is a query container
  (`container-type: inline-size`). A wrapped screen's `@media (max-width…)`
  rules become `@container` rules, so a narrow panel on a wide window reflows
  the way a narrow window does.
- **One of a kind.** A module that owns something there is one of (the
  terminal desk, the page's selection) sets `maxPerView`.
- **Rails step aside.** Add the route to `composedViewFor` only when the
  composition replaces everything the route's rail and inspector showed.

`config` is the instance's settings: scope values, or anything the module
needs to keep (Terminal keeps what it runs, where, and a session nonce).
`setConfig({ key: "" })` clears a key. Changing settings counts as a change to
the view, and Reset clears them.

## Always draws correctly

- **Minimums.** `minSize` is enforced by the grid on drag, keyboard sizing,
  column fit (12 → 8) and restore. While sizing, the panel shows `w × h` and
  says `min` when its minimum stops it.
- **Container queries.** Panel bodies are `container-type: inline-size`;
  rows drop secondary columns under 420px (`views.css`). Use `@container`,
  never the viewport, inside a module.
- **Fill the body.** The body is a flex child with `min-height: 0`. A module
  that needs a measured box (Terminal) fills it with `height: 100%`.
- **Expand** (`e`, `←→`, double-click the head) grows into free columns, or
  takes the full row. It remembers what to restore to across reloads.
- **Full view** (`f`, `⤢`) lifts one panel over the grid without moving or
  remounting anything; `esc` returns. A terminal keeps its session through it.
  `⌘⇧B` lifts the terminal's panel (the one typed into, else the first that
  draws a terminal), as it gave a full-bleed terminal the screen; a module
  asks with HudGrid's `requestFullView(panel)`.

## Adding a module

1. Copy the smallest one that looks like yours (`activity.tsx` for a polled
   list, `agents.tsx` for scopes, `terminal.tsx` for settings).
2. Open the file with the doc block: `Shows:` `Data:` `Scope:` `Opens:`.
3. Export it through `defineModule({...})` and add it to `registry.ts`.
4. `bun test client/screens/views` checks the doc block, sizes and registry.

## The modules

| Module | Scope | Data |
|---|---|---|
| Terminal | what · where (in its strip) | hudsonkit terminal relay, a fresh pty per panel |
| Terminals (`terminal-index`) | none (the rail's own Projects/Recent tabs and folds); takes "/" on a terminal's page, where no workspace does | `/api/terminal-sessions` every 8s; herdr topology per live layout |
| Workspace (`terminal-workspace`) | none; one per view | `/api/terminal-sessions` every 8s, `/api/terminal-workspaces`; a relay per live tile |
| Terminal session | terminal: "This page's terminal" (the deep link's target and `?mode=`; Observe and Take over move the page), or unset, its own pick (agent, registered session, herdr) | TerminalContent for that target; following the page, the page's own relay keys; its own pick, a relay keyed by panel |
| Terminal details | terminal: "This page's terminal", or its own pick | the terminal inspector for that target |
| Agents | project (a root, or "This page's project": any of its checkouts, on the page's machine) · host · harness · state | `useScout().agents`; the page project's checkouts from `useProjectsInbox()` when following the page |
| Tail | q: "This page's filter" (`@route`; on /ops/tail the URL's `?q=` and follow ids, resolved to one harness session) or a project or harness the tail watches; unset = every session (Watch, Comms) | the broker tail stream through TailView, pushed; `/api/tail/recent` on open and on Earlier (2,000, then 5,000 lines); `/api/tail/discover` every 30s (the picker's options every 60s); `/api/follow` every 5s while following |
| Alerts (`alerts`) | q, as Tail (`@route` on /ops/issues: its `?q=`) | the same stream as Tail, warnings and errors (err · wrn+ · all) |
| Event (`tail-event`) | none; one per view | the latest pick of a Tail or Alerts panel on the view (tail-picks.ts); no reads of its own |
| Following (`tail-follow`) | none; one per view; follows the page | the page's follow ids; `/api/follow` every 5s while they are there; the ask from `/api/fleet`, 15s |
| Requests · Active (`ops-queue`) | none | `loadFleet()` (`/api/fleet`) on open and on message, flight and collaboration events: the Ops rail's queue, uncut |
| Activity | follow (`@route` on /activity: its `?event=` is the selection, written with replace) or an own pick, event (state); project · kind (the log's five groups); the page's `?machineId=` always narrows it | `/api/activity` (the 60 newest), one loop shared by the Activity page and every Activity panel (screens/activity/activity-feed.ts): warm from a read under 30s old, one read per 250ms burst of broker data events, every 15s while visible, and on Refresh |
| Activity details (`activity-item`) | none; one per view | the Activity page's `?event=`, or the latest pick of an Activity panel on the view (activity-picks.ts); the record from the shared activity loop, no reads of its own |
| Briefings (`briefings`) | none; on /briefings the URL is the selection (the open briefing marked); elsewhere its own pick, kept as state (`briefing`) | `/api/briefings?limit=50`, one read for the page, every Briefings and Briefing panel and the Briefing scope's picker (briefings/use-briefings.ts): on open unless under 30s old, then every 60s while visible; Refresh reads it, and every open briefing, again |
| Briefing (`briefing`) | briefing: "This page's briefing" (on /briefings/:id the URL; elsewhere the pick of a Briefings panel beside it), unset = the latest, or one pinned | `/api/briefings/:id`, shared: one read per briefing however many panels show it, warm from a read under 30s old, read again when the archive shows it was written again; a 404 reads as gone (the archive keeps 100) |
| Fleet cockpit (`home-cockpit`) | none; one per view. Option: Subscription gauges (`gauges`, on by default) | the Home feed (use-home-feed.ts): its fleet reads for the sync line and its `/api/service-budgets` read (every 60s) for the head gauges, the one Subscriptions & quotas draws. Shortcuts: this browser's storage (home/cockpit-shortcuts.ts), not the view, so Reset keeps them |
| Recent (`home-recent`) | none; the page's `?machineId=` narrows it | `useScout().agents`; `loadFleet()` (`/api/fleet`, the shared fleet store) on open and on fleet events: the Home rail, uncut |
| Conversations | project · harness · kind | `useConversationList()` |
| In flight / Recently done | agent | `/api/fleet`, 10s / 15s |
| Requests | follow (`@route` on /requests: its `?request=` is the selection, written with replace) or an own pick, request (state); kind (Approvals, Permission requests, Asks) | `useOperatorRequests()`, the one read every Requests surface shares (lib/operator-requests-store.ts): `/api/operator-attention` on first use, every 15s while Scout is in front, on return, after each decision and on Refresh; receipts from screens/requests/request-receipts.ts. A pick opens in the Request panel beside it, or under its row with none or in full view |
| Request (`request`) | request: "This page's request" (on /requests its `?request=`; elsewhere the pick of a Requests panel beside it, request-picks.ts), unset = the first open request, or one pinned | the shared operator-requests read and receipts, no reads of its own; a decision POSTs `/api/send` or `/api/operator-attention/{permissions,approvals}/decide` through the page's useRequestActions |
| Work | owner · show (active, or active and done); marks the page's item | `/api/work`, 20s, one read per page (use-work-detail.ts); the page's `?machineId=` narrows it |
| Work item (`work-item`) | work (follows the page, or pinned to one) | `/api/work/:id`, shared: one read per item however many panels show it, warm from a read under 30s old, one refresh per 250ms burst of broker events |
| Timeline (`work-timeline`) | work (follows the page) | the shared work item |
| Task tail (`work-tail`) | work (follows the page) | the shared work item; the live tail filtered to its run (`/api/tail/recent`, then the tail stream) |
| Files (`work-files`) | work (follows the page) | the shared work item's inventory; the open file through `/api/work/:id/material`; `/` finds a file inside the panel only |
| Flights (`work-flights`) | work (follows the page) | the shared work item: its flights, each one's delivery, its child work |
| Participants (`work-people`) | work (follows the page) | the shared work item: owner, next move, asker, who ran it, who wrote |
| Projects | host (unset: the page's `?machineId=`); its lens is `?state=` on the Projects view, `config.state` elsewhere | `useProjectsInbox()`, the shared Projects loop (60s and on change) |
| Project | project (follows the page) | `useProjectsInbox()`; crew from the roster; Add posts `/api/onboarding/project` |
| Sessions (`project-sessions`) | project (follows the page) · harness (`?harness=` wins on the view); one per view | `useProjectsInbox()` |
| Session | session (follows the page, or pinned to one) | the session's observe data or conversation by ref; its row from `useProjectsInbox()` |
| Session board (`session-board`) | follow (`@route` on a Sessions page: it marks the page's session and a row writes `/sessions/<ref>`, in place, or as a new entry from a flight page) or its own pick, kept as state (`session`); show (Working · Requests · From agents · Working or requests) · project · machine · harness · layout (List · Cards · Lanes) | one board read for the window (screens/sessions/session-board-store.ts): `/api/sessions`, `/api/conversations?limit=250`, `/api/tail/discover` and `/api/tail/recent?limit=1000` on open, every 15s while visible, once per second of broker data events, and on Refresh; live tail events batched every 250ms; `/api/mesh` once for this machine's id; requests from `useOperatorRequests()`; on a flight page the flight's record (screens/sessions/use-flight-record.ts) |
| Session thread (`session-thread`) | session: "This page's session" (`/sessions/<ref>` with its `?machineId=`, a flight's session; on bare /sessions and off the page, a Session board's pick), unset (the pick everywhere), or one pinned; layout (Desk · Reading · Sheet) | the session by ref (`/api/session-ref/:ref` through the Observe lookup, again on its events), its touched files, `/steer` and on Desk `/steer/audit` every 10s; its row from the shared board read; on a flight page the flight's record, one read per flight, warm 30s |
| Worktrees | project (follows the page; on /repos and /repo-diff the selected worktree's repo) | `useProjectRepositoryState`: the shared Repo Watch read (`/api/repo-watch` 10s, one expanded scan for a missing project), worktree diffs 20s, `/api/repo-prs` 60s, paused while hidden |
| Project agents (`project-agents`) | project (follows the page) | `useProjectsInbox()` and the roster |
| Agent activity (`agent-activity`) | agent: every agent, one, or "This page's agent" (its asks and posts only; never marks the feed seen); on the feed's own page, the `?select=` or session peek beside it | `/api/fleet` (shared fleet store) on fleet events; `/api/tail/recent` on open and every 60s while Scout is in front; the last visit in this browser; the peek from `useProjectsInbox()` |
| Agent (`agent`) | agent (follows the page, or pinned to one); off the page its tab, session and chat are state (`of` · `tab` · `session` · `conversation`) | the roster on the page's `?machineId=`; `/api/conversations` and the agent's session catalog on open and on broker events; the trace every 2.5s while live |
| Agent session (`agent-session`) | agent (follows the page: the page's session and Trace tab; pinned: the latest Agent panel showing that agent on the view, else its active session) | `/api/fleet` (shared store), the agent's session catalog and observe data, on open and on broker events |
| Agent card (`agent-card`) | agent (follows the page, or pinned to one: keep it on Watch) | `/api/fleet` (shared store), the agent's session catalog and observe data, on open and on broker events |
| Pull requests | project (a root, or "This page's project": every checkout, up to 12; on /repos and /repo-diff every repo, grouped by the selected worktree) | `/api/repo-prs` (gh), 2 min; Retry on failure. On the Repos routes, the read shared with the Repos list |
| Repos (`repos`) | on /repos and /repo-diff the URL's selection (`?root=`, `?path=`); elsewhere its own (`root`, state); one per view | the shared Repo Watch read (screens/repos/use-repo-watch.ts): `/api/repo-watch` 10s while visible, warm from the last scan; `/api/repo-prs` per repo checkout, 2 min, shared; the 12 likeliest diffs warmed |
| Worktree (`repo-worktree`) | checkout (follows the page: the URL's on the Repos routes, the Repos list's pick elsewhere; or a path) | the shared Repo Watch read; a missing root gets one expanded scan |
| Diff (`repo-diff`) | checkout (follows the page: on /repo-diff the URL's diff with its layers, files and session; or a path) | `/api/repo-diff` through the diff cache (shared in-flight reads, fresh 30s); the checkout from the shared Repo Watch read |
| Files (`code-files`) | root: "This page's repo" (on /code the URL; on a project, repo or diff page that checkout), a pinned root, or the last repo read; picking a repo pins it; file (state) | `/api/file/preview` per folder opened; the repo-watch quick snapshot (shared, screens/code/code-snapshot.ts), once and on each root switch |
| File (`code-file`) | file: "This page's file" (on /code the URL's file and lines), the file opened in a Files or Changes panel beside it, or a pinned file (root · line · endLine as state) | `/api/file/preview` once per file, shared for 30s; the path-filtered Git diff on Changes |
| Changes (`code-changes`) | root: "This page's repo", a pinned root, or the repo of the file open beside it | the shared repo-watch quick snapshot, on open and every 30s while visible |
| Hosts | none; a machine click is the view's pick (Machine and the Network map follow it); on any page `?machineId=` picks first | the shared Network loop (mesh/use-mesh-snapshot.ts): `/api/mesh` every 10s and a machine sweep every 15s, both paused while hidden |
| Machine | machine (follows the view's pick, or pinned to one; unset: the Network summary and Join mesh) | the shared Network loop; the machine's own reading, once per pick (lib/mesh-node-state.ts) |
| Network map (`mesh-map`) | machine (follows the page's `?machineId=`, or pinned; unset: every machine); one per view | the shared Network loop; agents from `useLocalAgents()` |
| Rack (`mesh-rack`) | none | the shared Network loop; the sweep's readings |
| Mesh Ops (`mesh-ops`) | on /mesh-ops the URL's `?machineId=` and `?itemId=`; elsewhere host (follows the page's `?machineId=`, or pinned) and the open item as state (`item`); one per view | `/api/mesh-ops` (limit 200) into the shared Mesh Ops store, read again on broker events at most every 750ms |
| Item (`mesh-ops-item`) | none; the URL's `?itemId=` on /mesh-ops, the board's pick elsewhere | the shared Mesh Ops store, read with the board's scope; Hold, Release, Accept and Clear POST `/api/mesh-ops/items/:id/…` |
| Mesh Ops hosts (`mesh-ops-hosts`) | none; on /mesh-ops a row scopes the page, elsewhere it opens /mesh-ops on that host | the shared Mesh Ops store; `/api/mesh` once per refresh for names |
| Mission wall (`mission-wall`) | none; one per view. On Ops › Control its cursor is the URL's `?sessionId=`, elsewhere its own; keys read from anywhere on the route, only with focus in the panel elsewhere | the tail firehose (socket, repainted every 250ms, 4000 lines), one recent-tail backfill, `/api/tail/discover` every 30s, observe polling for registered agents; the mission-control store |
| Mission roster (`mission-roster`) | none; one per view (its filters are the wall's); "/" finds its search from anywhere on the route, only in the panel elsewhere | the mission-control store the wall publishes its sessions to |
| Session context (`mission-context`) | none; one per view; reads the wall's cursor | the wall's cursor reading through `mission-dock.ts`: the registered agent's observe, else rebuilt from the tail |
| Ops summary (`ops-summary`) | none | `loadFleet()` on mount and on broker message, flight and collaboration events; `useScout().agents` |
| In flight (`worktrees-in-flight`) | none; every repo | the shared Repo Watch read (screens/repos/use-repo-watch.ts): `/api/repo-watch` 10s while visible; `/api/repo-prs` for one checkout per repo, 2 min, the read the Repos list shares; who is on a worktree from Repo Watch's attachments (agents with a broker state, harness sessions by cwd) |
| Stale (`stale`) | none | Host Advisor's shared read (`ops/host-advisor-data.ts`), on open and on broker data events: its Unattended items (`unattendedItems`) narrowed to relay processes and threads quiet past 2h (stale-model.ts) |
| Host readouts (`host-readouts`) | none; one per view | Host Advisor's shared read (`ops/host-advisor-data.ts`): /.host-info, /api/build, /api/service-budgets, /api/tail/discover, /api/knowledge/status, /api/pairing-state, /api/terminal-sessions and /api/sessions, on open and on broker data events. Refresh in the head reads again for every advisor panel |
| Host reading (`host-reading`) | reading: Attention · Unattended · Budgets · Subsystems · Processes ("" = the page's four) | the same shared read |
| This host (`this-host`) | none; one per view | /.host-info and /api/build, once on open (Host Advisor's inspector) |
| Plan (`plan`) | plan ("This page's plan" = ?plan= on Ops › In flight; "" = every plan found) | `/api/plan-documents` on open and every 60s while visible, one read for every Plan panel |
| Runtime summary (`runtime-summary`) | none | Runtime's shared feed (`ops/atop-feed.ts`): the broker tail stream, a 500-event replay, `/api/tail/discover` every 5s |
| Harness families (`harness-families`) | none | `/api/topology/snapshot`, once on open |
| Runtime (`runtime-table`) | harness · status (working, active, idle) · project ("This page's project": any of its checkouts) | Runtime's shared feed |
| Agents directory (`agents-directory`) | project ("This page's project") · host · harness · state, as Agents | `useScout().agents`; loadFleet(), /api/conversations, /api/activity and /api/observe/agents, on open and 1.5s after any broker event |
| Agent roster (`agents-roster`) | none; one per view | `useScout().agents`; /api/conversations on open and on conversation events; the fleet's active asks |
| Lanes (`lanes`) | project · harness, from the lanes it built (as the embed's `?project=` and `?harness=`); one per view. Keys read from anywhere on Ops › Lanes, only with focus in the panel elsewhere | the tail with transcript replay, `/api/tail/discover` every 60s, terminal sessions every 10s, observe for registered agents, a 10s clock; pins and widths in localStorage per profile, window, layout and scroll in sessionStorage; publishes its lanes through `lane-dock.ts` |
| Lane (`lane`) | lane ("This page's lane" = `?sessionId=` on Ops › Lanes; "" = the deck's pick; or one lane, pinned) | the lanes the deck beside it built, through `lane-dock.ts` (no second tail read); `/api/plan-documents` per lane |
| Lanes roster (`lanes-roster`) | none; one per view | the roster the deck publishes as it draws (`lane-roster-store.ts`); the fleet's live agents until its first draw |
| World (`world-stage`) | none; one per view. On Ops › World source and dataset are the URL's `?source=` and `?data=`, elsewhere its own; keys read from anywhere on the route, only with focus in a World panel elsewhere | the HUD engine (screens/ops/world-week, three.js, loaded when the panel draws): `/api/ops/world-week` once per mount (`?data=team` for the team), or the `/api/ops/world-live` stream (`?source=live` or `otlp`); typed and spoken words through `/api/ops/world-command` and `/api/ops/world-ask` (world-week/voice.tsx) |
| Agents (`world-readouts`) | none; one per view; follows the World panel | none of its own: the World panel's engine paints the HUD's left column into it (`world-dock.ts`) |
| Inspector (`world-details`) | none; one per view; follows the World panel | none of its own: the HUD's right column; previews and the stash read `/api/ops/world-file` and `/api/ops/world-stash` through the engine |
| Subscriptions | provider | the shared Providers loop (harnesses/use-service-budgets.ts): `/api/service-budgets` warm from a read under 30s old, read now, forced (`?refresh=1`) 600ms after, then every 30s while showing |
| Model defaults (`provider-routing`) | none; read-only | global runtime catalog from `/api/runner/options`, with a labeled included fallback |
| Cloud accounts (`cloud-accounts`) | none | the shared Providers loop |
| Plans & quotas | provider | the shared Providers loop, every 30s while showing; never forces a provider refresh |
| Search box (`search`) | — | none; opens Search |
| Search (`search-results`) | follow (`@route` on the Search view) or an own search: q · source · harness · project · time; hit (state) | `/api/knowledge/search`, 180ms debounce; `/api/knowledge/search-primitives` after index runs |
| Result (`search-hit`) | none; one per view | the Search page's `?hit=`, or a Search panel's pick on the view; `/api/knowledge/source-preview` per moment |
| Search index (`search-index`) | none; one per view | `/api/knowledge/status`, every 1.5s while indexing; refreshes in the background on open (shared store) |
| Ledger (`dispatches`) | on /dispatch the URL's outcome · focus · Between · window and open dispatch; elsewhere its own (its focus bar and tabs), the open dispatch as state (`attempt`); one per view | `/api/broker` through the shared dispatch ledger (broker/use-dispatch-ledger.ts): warm from a read under 30s old, one refresh per 250ms burst of message and delivery events |
| Routes (`dispatch-routes`) | on /dispatch the URL's; elsewhere focus (Focus on a node, a chip clears) · outcome · window | the shared dispatch ledger |
| Health (`dispatch-health`) | on /dispatch the URL's; elsewhere focus · window (it counts every outcome) | the shared dispatch ledger |
| Voice stage (`voice-stage`) | none; follows the call and the held turn | the /voice session store (screens/voice/voice-session.ts) and the app-root GPT Live call; no reads of its own |
| Voice call (`voice-call`) | none; one per view (it holds the Local Live take) | the app-root GPT Live call; the session store; `/api/voice/realtime/settings` and `/api/voice/settings` once while any Voice panel is open; Local Live's engine (ScoutbotPanel: `/api/scoutbot/session`, the shared voice client) |
| Voice turns (`voice-turns`) | none; picking a turn holds it for the stage and Voice turn | the call's turn ledger (GPT Live from the provider, Local Live from the session store) |
| Voice turn (`voice-turn`) | none; one per view; takes the lanes off the stage | the turn ledger; its details read `/api/voice/history`, `/api/scoutbot/session`, `/api/perf/recent` once opened |
| Voice usage (`voice-usage`) | none; one per view | `/api/voice/usage` every 5s while visible |

Agent, Agent session and Agent card draw the Agents screens' own parts (the
profile, the agent inspector), so Observe, Take over and every action on the
page work the same in a panel. On an agent's page they are the page: the URL
holds the tab and session, and Back undoes them. Off it, an Agent panel keeps
its tab and session in its settings for its own agent and never moves the page;
anything that leaves the agent goes there, and Back returns to the page the
panel sits on. An Agent session panel off the page follows the latest Agent
panel on the view that shows its agent.

Every Code panel reads one repo-watch snapshot and one 30s file cache
(screens/code/code-snapshot.ts, code-preview.ts), so a file hovered in Files
opens in File with no round trip. On /code the URL is the selection: a click in
Files or Changes pushes it, and File reads it, lines included. Off the route
Files keeps its root and file in its settings and never navigates; File shows
the latest file opened in a Files or Changes panel beside it (code-pick.ts), or
a pinned one; "Open full" is the only way to /code.

Every Voice panel reads one session (screens/voice/use-voice-session.ts);
none holds the call. GPT Live's peer connection, mic, playback and lease live
in the app-root provider, so moving, resizing, full view, Reset or removing a
panel never touches a running call. Local Live's mic take and reply audio live
in the one engine the Voice call panel mounts (`maxPerView: 1`): removing that
panel, or leaving /voice, ends the take, and the session closes the turn.

Every Network panel reads one `/api/mesh` loop and one machine sweep, and
every Providers panel (Plans & quotas included) one `/api/service-budgets`
loop; none polls on its own. The Network panels share one pick, the mesh
view store's: `?machineId=` seeds it on any page, as /network always did, and
a Hosts, map or Rack click changes it. Every Mesh Ops panel on a view reads
the Mesh Ops store with one scope (the page's `?machineId=` on /mesh-ops,
every machine elsewhere) so they never refetch over each other; a board off
/mesh-ops narrows to its own host in the browser.

Every Session board and Session thread reads one board read (the slot
screen's, which Basic web still draws): the first reader starts the 15s poll,
the last stops it, and a burst of broker events makes one read however many
panels hear it. A flight page's record is one read per flight. On a Sessions
page the board set to follow it marks the page's session and a row writes the
URL; elsewhere it keeps its pick in its settings and hands it to a Session
thread beside it (session-picks.ts), or opens the session's page when none
shows picks. Pin on a following thread holds its session as the page moves on.

Every Projects panel reads the one `useProjectsInbox` loop; none polls the inbox
on its own. A Search panel off the Search route keeps its search in its own
settings under the URL's parameter names and never navigates; "Open full" is
the only way to /search. A Result panel off the route shows the latest pick
from the Search panels beside it.

Every Repos panel, and Worktrees anywhere, reads one Repo Watch poll
(`screens/repos/use-repo-watch.ts`): the first reader starts it, the last stops
it, and two panels on the same repo never poll twice. On /repos and /repo-diff
the URL holds the selection: a row replaces `?root=` (keeping `?machineId=`),
a diff opens `/repo-diff?path=`, and Close on the diff returns to
`/repos?root=`. Off those routes the Repos list keeps its selection in its
settings, and panels following the page show what it selected; a panel pinned
to a path keeps its own.

Every Dispatch panel reads one dispatch ledger; none fetches `/api/broker` on
its own. On /dispatch they also share one scope (the URL) and one search box
(the Ledger's), so Focus on a Routes node narrows the Ledger, its counts and
Health together. Off the route each keeps its own scope in its settings, and
"Open full" opens that scope (and the Ledger's open dispatch) on /dispatch.

A Tail or Alerts panel hands a picked row to the Event panel beside it while
one is on the view and the panel is not in full view; otherwise it opens its
own sheet, as an embedded tail always has. On its own Ops page it keeps the
page's keys (`/` filter, `G` live, `esc`); anywhere else they work while
focus is in the panel. Typing in its filter narrows the panel only, as it
always did on the page; "Open full" takes an own filter to Ops › Tail.

Every Mission panel reads the one mission-control store: source, search, window,
order, selection and the wall's visible sessions. Only the wall reads the tail
firehose. The wall passes what its cursor is on to a Session context panel
through `mission-dock.ts`. With no context panel on the view, Enter opens that
reading over the wall's right edge, as on the full screen. The roster and the
context panel say so when no wall is on the view.

Host Advisor's full page, the advisor panels (Stale among them) and Runtime's page and panels each
share one read (a module-level store, refcounted while anything is mounted), so
adding panels never adds fetches. Runtime, Agents and Lanes reuse Ops summary
and Requests · Active beside them.

Only the Lanes deck reads the tail. It hands the lanes it built, its window and
its project pins to a Lane panel through `lane-dock.ts`, and its columns to the
Lanes roster through `lane-roster-store.ts`. A lane opened on the deck (its
card, Enter or i) goes to a Lane panel that shows the deck's pick while one is
on the view and the deck is not in full view; on Ops › Lanes it is written to
`?sessionId=` (replace). Otherwise the lane sheet opens over the deck, as on
the full screen. The lane cards, their motion and the deck's bar are the
screen's own (AgentLanesView); the floor stays /ops/fleet.

World is one engine (screens/ops/world-week/engine.ts) in one panel
(`maxPerView: 1`), drawn as the page draws it. Its left and right columns are
the engine's own elements: `world-dock.ts` moves each into the Agents
or Inspector panel while one is on the view, and back into the HUD's frame
when that panel is removed or the World is in full view, so nothing is rebuilt
and nothing the page showed is lost. Inspect, the stash and previews open in
the details column wherever it is. The engine reads keys from the window; on
Ops › World it keeps them page-wide, but leaves Enter and Space on a panel's
head buttons, and esc, f, e and the moves on a panel's own frame, to the grid.

Every Requests surface (the Requests and Request panels, the native
/embed/requests page and the sidebar count) reads one operator-requests store,
and a decision leaves its receipt in one shared store
(screens/requests/request-receipts.ts). So a card answered in one panel stays,
marked, in every panel that lists it until the receipt is dismissed, and a
decision on its way holds the card's buttons everywhere.
