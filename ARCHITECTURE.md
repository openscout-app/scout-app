# Scout App Architecture & Surface Ontology

`openscout-app/scout-app` is the canonical source-available web application and composable UI kit for [Scout](https://github.com/openscout-app/scout) (PolyForm Shield 1.0.0). Both the full local app and every standalone `npx` entry point (`openscout-app/feed`, `sessions`, `boards`, `chat`, `search`, `studio`) configure components exported from this codebase rather than maintaining separate UI forks.

---

## 1. Surface Ontology (Altitude & Chronological Spine)

The primary navigation is ordered from the **front door** (`Feed`) down the **altitude & chronological arc of work** — from planning intent, to discussion, to live execution, to recall, down to inspecting the machine:

| Order | Sidebar Row | Altitude / Job | Sub-pages | Package Export / Entry Point |
| ---: | --- | --- | --- | --- |
| **1** | **Feed** *(default)* | **Front door** — decisions waiting on the operator + finished outcomes | Single stream (`All · Reviewed`) | `scout-app/feed` → `openscout-app/feed` |
| — | *hairline* | | | |
| **2** | **Board** | **Plan** — work items, specs, reviews, and projects | `Board` · `Projects` | `scout-app/board` → `openscout-app/boards` |
| **3** | **Chat** | **Talk & ask** — operator-to-agent and multi-agent rooms & DMs | Single surface (rooms & DMs) | `scout-app/chat` → `openscout-app/chat` |
| **4** | **Sessions** | **See in action** — live and recent harness sessions | Single surface (`Sessions`, with `Lanes` lighting it) | `scout-app/sessions` → `openscout-app/sessions` |
| **5** | **Search** | **Recall** — lexical + structured search across sessions, messages, and cards | Single surface (`Search`, also `⌘K`) | `scout-app/search` → `openscout-app/search` |
| **6** | **Control** | **Inspect the metal** — live control wall, terminals, event tail, processes, hosts | `Control` · `Terminals` · `Tail` · `Processes` · `Hosts` | `scout-app/control` |
| — | *footer* | | | |
| **Foot** | **Settings** | **Frame & local configuration** | `General / Appearance` · `Voice` · `Agents` | Shell-owned |

### What Stays Out of `scout-app` (Platform-Only)
Hosted and multi-tenant operational views live in the private platform repository, not `scout-app`:
- Hosted Chat & Cloud / Managed Agents
- Slack & external SaaS bridges
- Cockpit, Overview (`world-week`), Explorer (`world` / `canvas`), Status, and Dispatch (`broker`)

---

## 2. Self-Referential Composable Kit (`./shell`, `./primitives`, `./vite`)

Every standalone entry point is a ~100-line configuration of `scout-app` components, compiled into prebuilt static HTML (`dist/index.html`) that stands up immediately on its own Node HTTP server and delegates data and actions to the `scout` CLI (`@openscout/scout`):

1. **`scout-app/shell` + `scout-app/shell.css`:** `<ScoutAppFrame>` (renders a slim single-page header bar when `pages.length === 1` and the collapsible Scout sidebar rail when `pages.length > 1`, plus `<ScoutAppearance>`, runtime status pill, setup banner, and `<ScoutPageSkeleton>`).
2. **`scout-app/shell/boot-html` & `scout-app/vite`:** `defineScoutThinViteConfig({ product, variant })` injects the pre-rendered Scout header and surface-specific skeleton (`feed`, `sessions`, `search`, `board`, `chat`, `canvas`) directly into `dist/index.html` at build time so the HTML paints a complete page skeleton before JavaScript executes or CLI/runtime reads return.
3. **`scout-app/primitives`:** `HarnessMark`, `DiffStat`, `ScoutMark`, and `ScoutGlyph` icons.
4. **Provider-free surface exports (`./feed`, `./sessions`, etc.):** Surfaces such as `FeedStandaloneSurface` and `SessionsStandaloneSurface` run without `ScoutProvider`, accepting browser navigation and same-origin `/api/*` reads backed by each entry point's appropriate `scout` CLI / runtime adapter.
