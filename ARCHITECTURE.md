# Scout App Architecture & Surface Ontology

`openscout-app/scout-app` is the canonical source-available web application for [Scout](https://github.com/openscout-app/scout) (PolyForm Shield 1.0.0). Every standalone launcher (`openscout-app/feed`, `chat`, `boards`, `search`) and the private platform consume surfaces from this single codebase rather than maintaining separate UI forks.

---

## 1. Surface Ontology (Altitude & Chronological Spine)

The primary navigation is ordered from the **front door** (`Feed`) down the **altitude & chronological arc of work** — from planning intent, to discussion, to live execution, to recall, down to inspecting the machine:

| Order | Sidebar Row | Altitude / Job | Sub-pages | Embed / Package Seam |
| ---: | --- | --- | --- | --- |
| **1** | **Feed** *(default)* | **Front door** — decisions waiting on the operator + finished outcomes | Single stream (`All · Results · My activity`) | `scout-app/feed` → `openscout-app/feed` |
| — | *hairline* | | | |
| **2** | **Board** | **Plan** — work items, specs, reviews, and projects | `Board` · `Projects` | `scout-app/board` → `openscout-app/boards` |
| **3** | **Chat** | **Talk & ask** — operator-to-agent and multi-agent rooms & DMs | Single surface (rooms & DMs) | `scout-app/chat` → `openscout-app/chat` |
| **4** | **Sessions** | **See in action** — live and recent harness sessions | Single surface (`Sessions`, with `Lanes` lighting it) | `scout-app/sessions` |
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

## 2. Reusable Surface Contract

Each primary surface follows the pattern established by `Feed`:
1. **Single authoritative UI implementation** inside `packages/web/client/screens/<surface>/`.
2. **Runtime capability props (`<Surface>Capabilities`):**
   - Standalone launchers (`npx openscout-app/feed`, etc.) mount `/embed/<surface>` or import the surface package with `readOnly: true` and a `handoff` descriptor.
   - Full `scout-app` and the private platform mount the exact same compiled module inside `OpenScoutAppShell` (`hudsonkit` frame, collapsible sidebar, looks/style engine, side & bottom panels) with `readOnly: false`.
3. **Zero lookalike shells:** `mode="app"` always uses the real `OpenScoutAppShell` + `ScoutSidebar` + `FrameSheet` + `styles/*`; `mode="embed"` renders the surface alone with zero shell assets.
