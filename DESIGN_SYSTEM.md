# Scout Surface Design System

Thin Scout apps share a masthead, a content rail, and a small action vocabulary.
Use these building blocks instead of setting widths and creating controls per app.

## Mount a surface

1. Import `scout-app/shell.css` and mount the app in `ScoutThinApp` (or `ScoutAppFrame` when providing custom navigation tabs).
2. Set the product noun and skeleton variant (`product`, `variant`, optional `rail`). Match them in `defineScoutThinViteConfig`.
3. `ScoutThinApp` polls `/api/status`, posts `/api/setup`, and routes `/sessions/:id` and `/c/:id` to the full-fidelity `StandaloneSessionDetail` and `StandaloneConversationExchange` views automatically.
4. Pass `serverEntry` in `defineScoutThinViteConfig` to compile the app's `scout-app/thin-server` entry to `dist/thin-server.mjs` alongside `dist/index.html`, giving every `npx` app shared loopback security, port-probing, tab reuse, `setup`/`status` CLI commands, and local transcript + runtime record resolution.
5. Let the frame own horizontal padding and scrolling. Set `layout="hosted"`
   on a Feed stream mounted in the frame. This does not set `embedded`, which
   independently controls the undo toast and read-only handoff.

## Select one rail

| Rail | Default variants | Content measure | Desktop border-box max |
| --- | --- | ---: | ---: |
| `reading` | Feed, Search | 760px | 808px |
| `wide` | Sessions, Board, Canvas | 1180px | 1228px |
| `full` | Chat, no variant | Available width | None |

Reading and wide rails center with `margin-inline: auto`. Their border box
includes 24px of padding per side, or 16px at viewport widths up to 560px.
The full rail adds no padding. The shared class is `.s-surface-rail`; select
its measure with `data-rail`.

Set the same `rail` override on the frame and in the boot configuration.
Align setup copy and record views to the same rail as the live surface.
Pass `inline` to `ScoutPageSkeleton` inside an existing rail to avoid a
second set of gutters.

## Keep boot and hydration aligned

`renderBootShellHtml` renders the masthead and skeleton before JavaScript
loads. Keep the rail measures, breakpoint, and gutters in
`BOOT_SHELL_CRITICAL_CSS` in sync with the shell's rail stylesheet.
Boot and the hydrated frame reserve the same space for classic scrollbars.
The thin masthead is 40px tall; the full app uses its platform height.
Use a sentence-case brand such as “Scout Feed”. Disable boot and skeleton
pulses when the system requests reduced motion.

## Use type and color by role

| Role | Type |
| --- | --- |
| Masthead brand | 14px sans, 500, −0.005em tracking |
| Section heading (`.s-ds-section-head`) | 13px sans, 500, normal tracking |
| Actions and secondary copy | 12px sans |
| Feed lead and decision | 15px sans, 500 |
| Timestamps and repository labels | 11px mono |

| Thin shell token | Dark | Light |
| --- | --- | --- |
| `--scout-thin-bg` | `#0c0d10` | `#fbfbfa` |
| `--scout-thin-ink` | `#eceef2` | `#18191c` |
| `--accent` | `#e8a33d` | `#b86e00` |

Use `--scout-line` for rules and `--scout-line-strong` for quiet button
outlines. Use the existing spacing, type, and radius tokens in component CSS.

## Choose an action

- Use `ScoutActionButton` from `scout-app/primitives` for the next step.
  It uses `.s-ds-btn`: 28px high, `--radius-sm`, accent outline, no fill.
- Add `quiet` for a companion action such as Done. The button uses neutral
  ink and a stronger neutral rule.
- Use `.s-ds-act` for secondary text actions. It darkens to strong ink and
  underlines on hover or keyboard focus.
- Keep controls reachable by keyboard and visible on touch. Use a bottom
  rule, not a filled card, for a runtime setup note.
