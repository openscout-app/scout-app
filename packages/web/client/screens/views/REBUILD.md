# The view rebuild

Every Scout view is being rebuilt as a composition of modules on the HUD grid
(the contract is `modules/README.md`). This file is the ledger: what is
composed, what is being built, what is blocked, and what is left.

Update it in the same commit that changes a view. `rebuild-ledger.test.ts`
parses the Status table: each row's URL must reach that view, a `composed` row
must be claimed by `composedViewFor` with its Composition id, any other row must
not be, and every hosted composition in `views-model.ts` must have a row.

Status: `composed` (its panels draw on its own route), `building` (a builder is
on it), `blocked` (the live checkout has uncommitted work there that is not on
origin/main), `todo` (not started), `stays` (full page by design).

"Held" files are ones the live checkout has changed and origin/main does not
have. Most of its uncommitted files (96 of 191 on 10-14) are byte-identical to
origin/main, landed by other routes, so they hold nothing back.

## Status

| View | URL | Status | Composition | Notes |
|---|---|---|---|---|
| Terminals | /terminal | composed | terminals | Terminals index + Workspace |
| Terminal | /terminal/agent-1 | composed | terminal | Terminal session · Terminals index · Terminal details; session and details follow the page's terminal and `?mode=`; ⌘⇧B lifts the terminal's panel to full view |
| Search | /search?q=tail | composed | search | Search · Result · Search index; `?hit=` follows the page |
| Projects list | /projects | composed | projects | the list leads; Project lists every project's sessions |
| Project | /projects/openscout | composed | project-snapshot | the Overview: what waits, what works, what is in review and what landed |
| Project sessions | /projects/openscout?by=sessions | composed | project | looking by sessions: Project, Thread, Changes; no project list |
| Project session | /projects/openscout/sessions/s1 | composed | project | Thread follows the page's session |
| Project worktrees | /projects/openscout?by=worktrees | composed | projects-worktrees | the page looking by worktrees: pull requests and branches |
| Project pull request | /projects/openscout?pr=12 | composed | projects-worktrees | Branches shows the PR, Diff its file |
| Agents | /agents | composed | agents | Agent activity · Projects; the `?select=` peek draws in the feed's panel |
| Agent | /agents/agent-1 | composed | agent | Agent · Agent session · Projects; panels follow the page's agent, tab and session |
| Agent info | /agent/c1 | stays | — | a conversation's casefile, reached by URL only; its Open in Agents lands on Agent |
| Repos | /repos | stays | — | the Changes page: a fixed page with two layouts (Classic, Wide diff) instead of a grid; thin worktree list, the diff, one details pane; `?root=` selects, one Repo Watch poll |
| Repo diff | /repo-diff?path=a | stays | — | the Changes page with the URL's diff (layers, files, session); Close returns to `/repos?root=` |
| Code | /code | composed | code | Files · File · Changes; every /code URL is the selection; /embed/code keeps the page |
| Dispatch | /dispatch | composed | dispatch | Routes · Health · Ledger · In flight; `?attempt=` opens in the Ledger |
| Work list | /work | stays | — | the work page (screens/work/WorkPage.tsx) with its list open and nothing picked |
| Work | /work/w1 | stays | — | a fixed page, not a grid: the work list folded to titles, the work item, and one detail pane (Flight · Timeline · Tail · Files) beside it or under it; replaced the seven-panel composition 2026-11-12 |
| Work board | /work/board | composed | work-board | Board · Moves; stations as columns, the runtime checks each move, reviews wait in Moves |
| Follow | /follow?view=tail&flightId=f | stays | — | a resolver: replaces itself with the receipt's page (Ops Tail, Sessions, the chat, /work/:id) |
| Ops Control | /ops/control | composed | ops-control | Mission roster · Mission wall · Session context · Ops summary; `?sessionId=` is the wall's cursor; bare /ops too |
| Ops Tail | /ops/tail | composed | ops-tail | Tail · Event · Following · Requests · Active; the stream follows the page's `?q=` and follow ids |
| Ops Issues | /ops/issues | composed | ops-issues | Alerts · Event · Requests · Active; /ops/errors and /ops/warnings land here too |
| Ops Advisor | /ops/in-flight | composed | ops-advisor | In flight · Stale · Plan (`?plan=`); replaced Host Advisor 2026-10-16 (/ops/advisor and the legacy /ops/plan still land here); Budgets live in Providers, the subsystems watcher went |
| Ops Runtime | /ops/atop | composed | ops-runtime | summary, harness families, the table, beside Ops summary and Requests · Active |
| Ops Agents | /ops/agents | composed | ops-agents | the directory, beside Ops summary and the roster |
| Ops Lanes | /ops/lanes | composed | ops-lanes | Lanes roster · Lanes · Lane · Ops summary · Requests · Active; the deck opens a lane in Lane, `?sessionId=` is that lane; with no Lane panel (or in full view) the lane sheet opens over the deck |
| Ops Fleet | /ops/fleet | stays | — | the floor: AgentLanesView in floor mode with its roster rail; the deck's Floor button opens it |
| Ops World | /ops/world | composed | ops-world | World · Agents · Inspector: the HUD's engine whole in one panel, its left and right columns moved into panels beside it (world-dock.ts), back in its frame when a column panel is removed or the World is in full view; `?source=` and `?data=` are the HUD's; voice.tsx imported, unchanged |
| Ops Cockpit | /ops/cockpit | composed | home | Home's old grid, moved whole when Home became the front page: Fleet cockpit · Subscriptions & quotas · Fleet velocity · What's moving · Scout coordination · Tail · Message · Recent, on the Home grid's cells (Desk · Focus · Watch); the view keeps the id `home`, so saved arrangements carry over; Home's Look closer opens it |
| Home | / | stays | — | the front page (screens/home/front-page): For you, Running, Landed and the doors, one fixed page with no rail or inspector (`pageOwnsSides`); /embed/home draws it too; basic web keeps the old grid |
| Fleet | /fleet | stays | — | the legacy address parses to Home and draws the front page |
| Chat | /messages | blocked | — | live checkout: the Session port (screens/chat: SessionView, ConversationScreen, ConversationPanels, turn-steps) |
| Conversation | /c/c1 | blocked | — | live checkout: the Session port (screens/chat) |
| Requests | /requests | composed | requests | Requests · Request; `?request=` follows the page (bare /requests: the Request panel shows the first open request); one shared /api/operator-attention read and one set of receipts; /embed/requests keeps the page |
| Request | /requests?request=q1 | composed | requests | the Request panel follows the page's request with its answers, Allow and Deny, and the list marks it; Clear returns to /requests |
| Sessions | /sessions | composed | sessions | Session board · Session thread over one board read; bare /sessions: the board marks its first row and the thread shows it, a pick writes `/sessions/<ref>` in place |
| Session | /sessions/s1 | composed | sessions | the slot screen already drew one session beside its board, so it composes too; the board marks the page's session, the thread follows it on the page's `?machineId=` |
| Flight | /flights/f1/observe | composed | sessions | the thread draws the flight's bar (`?session=`, `?compare=` side by side); the board marks only the flight's session, a pick from it is a new entry so Back returns to the flight |
| Mesh | /network | composed | mesh | Hosts and Rack · Network map · Machine; `?machineId=` picks the machine |
| Mesh ops | /mesh-ops | composed | mesh-ops | Mesh Ops hosts · Mesh Ops · Item; `?machineId=` picks the host |
| Mesh ops item | /mesh-ops/i1 | composed | mesh-ops | a pick writes `/mesh-ops/<item>`; the Item panel follows it and reads the summary as markdown |
| Providers | /providers | composed | providers | Subscriptions · Cloud accounts · Routing (Budget and Routing side by side) |
| Activity | /activity | composed | activity | Activity · Activity details · Recent; `?event=` follows the page (the record opens in Activity details, or under its row with no details panel); `?machineId=` narrows the log; one shared /api/activity loop |
| Briefings | /briefings | composed | briefings | Briefings · Briefing · Recent; bare /briefings: the list leads, the Briefing panel waits for a pick; Recent is the Home rail the page had |
| Briefing | /briefings/b1 | composed | briefings | the Briefing panel follows the page's briefing and the list marks it; Close returns to /briefings |
| Settings | /settings | todo | — | has its own revamp (one web page); decide whether it composes |
| Voice | /voice | composed | voice | Voice stage · Voice call · Voice turns · Voice turn · Voice usage over one session store; the call stays above the panels (GPT Live at the app root, Local Live in the Voice call panel's engine); /embed/voice keeps the page |

Library compositions with no route of their own (open at `/views/:id`): Watch,
Comms, Machines. Full pages by design: `/embed/*` (native surfaces draw the
whole screen), Basic web.

## In flight

- The Sharp look (`/studies/sharper-hud` D, picked 10-15 on week) is the
  default. A `look` axis (Sharp or Classic) on <html> and the Provider,
  `?look=` that never persists, `styles/looks/sharp.css` (opaque stepped
  planes per palette, three ink tiers, opaque lines whose weight the contrast
  setting moves, square corners, 10px labels, flat elevation, ink focus ring,
  grain), and the HUD preset as the default (week, emerald, soft, square, chip
  avatars, ticks, Sharp). A save from before the axis keeps its look (ticks
  reads as Sharp, any other mix as Classic). The per-screen pass is in: every
  screen's CSS ends in a `Sharp look` section scoped to the look, so Classic
  renders as before (selections are ink plates, state is a mono-caps word,
  emerald only on live marks, no shadows or card-in-card). Checked in the
  browser on week: Projects, Dispatch, Ops Lanes, Terminals.
- Browser checks left: Take over on a terminal (skipped on purpose: it would
  attach to and resize a live session); a Reset with a call running and a
  panel moved (this browser can't drag or use a mic; Codex's repros stand in);
  Ops Agents once the full `/api/agents` read answers (see Open).
- Sessions (10-15): the inspector rail under Sharp is the Ledger
  (`/studies/session-rail` A): state and where, one row of the controls that
  exist (Terminal, Review, Pair, Copy id), one line of turns/tools/edits over
  the context bar, the changed files (eight, then Show all), Sent once
  something was sent, and usage, metadata and agents folded into Details.
  Classic keeps the stacked rail. A final delivery refusal reads as one plain
  line instead of a dead composer; idle background sessions take a new turn
  through their existing broker owner (no launch, resume or fork); no "steer"
  in visible copy. Checked on :43518 on a Codex and a Claude session.

## Open

Found during the Sharp pass, not fixed:

- `var(--signal)` is read in `requests-panels.css` and `requests.css` but
  never defined (both looks).
- `system-surfaces-redesign.css` near line 3329: rules meant for every width
  sit inside a `@media (max-width: 560px)` block.
- Tailwind `tracking-[0.12em]`, `rounded-full` and `rounded` in
  `ProjectAgentProfile.tsx` and `screens/agents/*.tsx` can't be reached from
  the look's CSS; they need markup changes.
- Live marks drawn as background gradients, the `.repo-grp.attn` 2px ink bar,
  and the blur behind `.ks-preview-head` and the roster's sticky heads were
  kept on purpose; say if they should go.

Decisions batch 6 left, none blocking:

- Home: Message always draws now (the old grid showed it only once
  coordination went quiet). Home's inspector never showed on the web, so the
  Agents module is one Add away rather than shipped. Every coordination panel
  shares one Lookback window (one /api/fleet read).
- Sessions: a saved slot deck and saved Lanes aren't imported (they stay on
  Basic web); the four presets (Desk, Focus, Board + sheet, Mix) are now a
  layout scope, not one-click; a board pick replaces the URL; the board
  doesn't narrow by `?machineId=` (it didn't before). Shared slot parts now
  say Send, Request and Requests, which reaches Basic web too.
- Requests: bare /requests shows the first open request (marked "First
  open") instead of waiting for a pick, unlike /work and /briefings. The Kind
  scope is new. Requests · Active stays off the page.
- Ops Lanes: no Host scope (tail lanes carry no machine yet); a Lane panel
  needs the deck on its view; a pick replaces `?sessionId=`; the deck is the
  one grid panel between the docked sides, so it never stacks and fills to
  the window's bottom at any width (check 1280, where it sits at the sides'
  480px floor). Lane focus now moves only when a key asks
  (it used to pull focus back on every redraw), which also changes /ops/fleet
  and the embeds.
- Ops World: the shell's collapsed Lanes rail is gone on the composed route
  (the lanes-roster module could stand in). Esc inside the World stays the
  World's; leave full view from the head button or the frame. At 8 columns
  The Inspector drops below the World, leaving space under the Agents column.
  `voice.tsx` is held, so its Enter and Esc stay page-wide while a proposal or
  speech is up.

Decisions batches 3 and 4 left, none blocking:

- The module library offers modules whose capability is off (Mission wall and
  the rest with `ops.control` off). The contract has no capability field yet.
- The inspector's Scoutbot panel is gone on every composed route. A Scoutbot
  module could stand in.
- Route-only compositions show as `/views` tabs: Terminal (no host) opens a
  terminal picker, and Agent lands on the Agents feed beside Agents. Hide them
  from the tabs, or keep them.
- At 8 columns Agent's minimums (3 + 4 + 3) don't fit across, so Agent session
  drops under the profile and leaves a gap under the list.
- Mesh Ops modules, like the Control ones, show in the library without their
  capability.
- Repos: the Worktrees panel's hook still reads PRs every 60s apart from the
  shared 2-minute read, and the shared Repo Watch keeps scanning deep once a
  wanted root needed it.
- Code reads this machine's files, so a Code panel on a remote machine's
  project page reads the local checkout of that slug.
- Screens now unreachable on the web (Work's inspector, the Mesh, Mesh Ops,
  Providers and agents-v2 full-page branches in resolve-panes,
  BriefingsScreen and BriefingDetailScreen): delete once the
  browser check passes.
- Bare /briefings waits for a pick, as bare /work does. It could show the
  latest briefing instead.
- New polling: the Briefings archive every 60s while visible (the page read it
  once), and Activity's 15s loop now runs on the Activity page too.
- An Activity panel already placed on a view now selects on click instead of
  opening the conversation; its Thread link still opens it. Home's Recent rows
  could link `/activity?event=`, which is the Home owner's call.
- Voice: a Local Live take ends when the Voice call panel is removed, as
  leaving /voice does (Reset keeps it running now). Mode now survives leaving /voice; `?mode=` could put
  it in the URL. The voice path diagram is retired, not a module.
- Typing in the Tail panel's filter never writes `?q=` back, against the
  README's "the URL wins". Alerts has no URL filter at all. Picking a machine
  on Network sets the selection without writing `?machineId=` (Codex round 7;
  older than this branch).
- The top bar names the page's area, not the page (SCO-088b): Home on
  Activity and Briefings, Settings on Voice, Dispatch on /work. A composed
  page's own name shows nowhere but its one-line description. Add it after
  the area ("Home / Activity"), or keep the area alone.
- Budgets: the Advisor reading and the quotas module read the same
  `/api/service-budgets`. One panel, or both.
- `/dispatch/<attempt>` drops the selection; only `?attempt=` opens it (Codex
  round 5, a router gap older than this branch).
- Polish seen in the browser: the Diff panel's file tree, at the Repos
  width, drops deep file names and shows only the status and counts; the
  Terminal session panel nests the old Terminal Control header (Summary ·
  Takeover) under its own Observe · Take over; Network at 1000 overflows the
  Hosts filter chips, clips "not checked yet" on the map's peer cards and
  crowds the Ops strip; Mesh ops colors status words amber and emerald
  (left for the style port's alarm token; its LAB strip shows only with dev
  tools on); expanding Voice call moves Voice turns below and leaves a hole
  beside Voice stage. Older than this branch: an Agent activity article
  prints a markdown table as raw pipes; the full `/api/agents` read every Ops
  route makes hangs on the worktree dev server, so Ops Agents' directory
  stays on "Reading the roster" (the summary read the other routes make
  answers).

## Waiting on the operator

- Pick a drag-out direction in `/studies/companion-drag-out`.

## Verified

- Codex rounds 1–4: every finding reproduced and fixed. Round 5: no new
  findings; 330 tests and 600,000 fitted layouts clean. Round 6: three P2s
  (the wall's detail lost in full view, Enter on Runtime's controls, a ledger
  test that passed a false ledger), fixed in `399b22b09` and re-verified by
  Codex (1,087 tests, no new findings). Round 7 (batch 4),
  first pass: an expanded Repo Watch look could undo a newer Refresh, fixed in
  `3bb33c64a` with a test that fails without it. Second pass (six worries, each
  checked by test, script or server render): that fix holds; two Changes
  panels polled Repo Watch on two timers, now one shared timer with a test that
  fails without it.
- Codex round 9 (the Sharp look): two P2s reproduced and fixed. A save from
  before the finish setting switched to Sharp (it now stays Classic with the
  defaults it was saved under); selected tabs and nav buttons lost their
  keyboard focus ring (Sharp now draws a 1px ink outline on focused controls).
- Browser on the worktree dev server: Terminals at 1600, 1200 and 720; Search
  query, results, `?hit=` and Result; Projects list, project and session at 1600
  and 1000; Dispatch at 1600 and 900 with a dispatch open in the Ledger.
- Ticks finish: panels are square and each bracket is the frame's own corner,
  unbroken on Rounded; edit mode keeps the dashed frame.
- Browser, batch 3 at 1600: Ops Control; Ops Tail with a pick opening in Event;
  Host Advisor (the Refresh chips now keep icon and label on one line); Runtime;
  Ops Issues with a picked alert opening in Event.
- Codex round 8 (batch 5): the shared Changes poll holds; two P2s reproduced
  and fixed in `db4d3cd36` (Reset remounted the grid and ended a Local Live
  take; an own Activity pick on /activity rewrote `?event=`). Codex's repros
  pass after and fail before.
- Browser at 1600: a Terminal deep link (the index row opens
  `/terminal/tmux/<session>`, the index marks it, session and details follow;
  Observe writes `?mode=observe` and the details say Read-only observe; full
  view lifts the session panel); Agents (a row opens its article inside the
  feed's panel); Agent (all three panels follow the page's agent and
  `?tab=config`); Repos (`?root=` marks the row, Worktree and Diff follow);
  Code (a `/code/<project>/<path>?line=` opens at the line). Code's Files panel
  showed "file not found" for every file once a saved open folder was gone;
  fixed in `4404043ba`.
- Browser at 1600, batch 5 and the rest: Work (a pick opens its item and the
  panels follow); Network at 1600 and 1000; Providers at 1000; Mesh ops (a
  pick writes `/mesh-ops/<item>`, the Item panel follows); Activity (a pick
  writes `?event=`, Activity details shows the record, the row offers Close);
  Briefings (a pick writes `/briefings/<id>`, the Briefing panel follows, the
  list marks it); Voice (full view and expand on Voice call, and back).
- Codex round 9: round 8's two fixes hold (a kept Local Live take survives
  Reset; an own Activity pick never navigates). Two P2s reproduced and fixed:
  a Reset mid-drag left the dragged panel's inline transform on it, and a
  failed read from the Code tree's previous root collapsed the new root's
  folders. Codex's repros (`/tmp/reverify-grid-reset-dom.ts`,
  `/tmp/reverify-code-tree.ts`) fail before and pass after; the repo has no
  DOM test library to hold them.
- Codex round 10: round 9's two fixes hold, and new probes (a Reset during a
  keyboard move, a Reset mid-resize while stacked) pass. One P2 reproduced
  and fixed: a Code root left and returned to (A, B, A) took the first
  visit's late folder read as current. Reads are now held to the visit that
  asked; `/tmp/round10-code-aba-api.ts` fails before and passes after.
- Codex round 12 (batch 6): three P2s, all fixed with tests. A permission's
  new version kept the old version's receipt and hid Allow/Deny (the version
  is now part of a card's revision); a Requests list with its own pick on
  /requests moved the page's `?request=` (only a list that follows the page
  writes it); Home's grid adoption marked itself done before copying, so a
  failed write never retried (the mark is written last). A lane focus corner
  case it found predates batch 6. Run views and requests as separate folders:
  together, one requests-panels test fails at HEAD too.
- Browser batch 6, at 1600: Home (eight panels on Desk, Tail live,
  coordination following the page's machine), Sessions (board and thread
  over one read), Requests (both panels empty, as the queue is), Ops Lanes
  (roster, deck, Lane, Ops summary, Requests · Active) and Ops World (the
  HUD whole, its columns docked as Agents and Inspector). The
  week read is cold on a fresh server (over two minutes on the worktree
  server, about 20s on the published one); warm, World draws at once. Still
  open in the browser: picks writing `?request=` and `?sessionId=`, and the
  narrow widths each builder named.
- Codex round 11: the visit guard holds. A, B, A drops the stale read and
  asks for two folders; StrictMode's double effect keeps its first reads; a
  late reveal can't reach another root or its saved tree; A, null, A drops
  old reads; a toggle racing a root switch drops either way. Clean, no new
  P1 or P2 (`/tmp/round11-visit-probes.ts`).
