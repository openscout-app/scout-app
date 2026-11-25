import { useCallback, useState, type CSSProperties, type ReactNode } from "react";

import {
  formatRenamePolicy,
  parseRenamePolicy,
  RENAME_MINUTES,
  RENAME_NEVER,
  RENAME_TURNS,
  type RenamePolicy,
} from "../../../../shared/session-rename.ts";
import { FIGURE_HOLDS, setCompanionFigureDefaults, type CompanionFigureDefaults } from "../../../lib/companion-host.ts";
import { CREW_ASSETS_AVAILABLE } from "../../../lib/crew-registry.ts";
import type { OperatorAttentionItem } from "../../../lib/types.ts";
import { FIGURE_HOLD_LABEL, FIGURE_MOTION_LABEL, FIGURE_MOTIONS, FIGURE_SIZE_PRESETS } from "../figure-model.ts";
import { FIGURE_LOOKS, setFigureLook, useFigureLook, type FigureLook } from "../led-figure/figure-look.ts";
import { readScoutbotPrefs, ScoutbotRequest, writeScoutbotPrefs, type ScoutbotPrefs } from "../Scoutbot.tsx";
import { ScoutbotPanel, useScoutbotSpeech } from "../ScoutbotTalk.tsx";
import { BOARD_CORNER_KEY, BOARD_INSET_KEY, parseBoardCorner, parseBoardInset, type BoardCorner, type BoardInset } from "./arrivals-model.ts";
import type { BoardLook } from "./BoardCells.tsx";
import { DEFAULT_BOARD_FOLDED, parseBoardFolded, type BoardFolded } from "./board-strip.ts";
import { BOARD_ORDER_KEY, parseBoardOrder, type BoardOrder } from "./board-order.ts";
import { NOTCH_EDGE_LABEL, parseBoardPlace, parseNotchEdge, type BoardPlace, type NotchEdge } from "./notch-model.ts";
import { DESK_CHARACTER_DEFAULT_LABEL, DESK_CHARACTER_DEFAULTS, setDeskCharacterDefault, useDeskCharacterDefault } from "./desk-character.ts";
import { DESK_FORM_LABEL, DESK_FORMS, setDefaultDeskForm, useDefaultDeskForm } from "./desk-form.ts";
import { setDeskRestLine, useDeskRestLine } from "./desk-rest.ts";
import type { RosterProjectRecord } from "../../../../shared/api/roster.ts";
import { draftProjectCode, projectDefaultCode } from "./roster-model.ts";
import { RosterImport } from "./RosterImport.tsx";
import { setRuntimeProjectCode } from "./runtime-roster.ts";

/*
 * The board's own settings, and Scoutbot beside it. The board is the stable
 * place (storyline layer 1); Scoutbot (layer 2) is always one click away
 * when it is wanted, and off when it is not; attached agents (layer 3) are
 * summoned with the overlay chord, and land as the figure or strip picked
 * here (each agent can change its own on the desk).
 */

/** Names on the companion's lines: the session's own title, or a short summary by a cheap model (session-titles.ts). */
export type BoardNames = "title" | "summary";
/** Who summarizes: the cheapest model of the session's own harness, or always Claude Haiku, or always Codex Luna. */
export type BoardNamesBy = "harness" | "claude" | "codex";
/** Folded lines: compact, or wider with each agent's latest step streaming under its name. */
export type BoardFoldedStyle = "compact" | "stream";
/** `inset` is where the board was dragged to, from its corner; picking a corner puts it back in the corner. */
/**
 * `blink`: a new ask runs a light along the screen edge (off unless turned on).
 * `meters`: the usage gauges and counts under the rows: always, only while a
 * provider runs high (the default, so the board at rest is its rows), or
 * never. `dots`: each row's activity as dots, off unless turned on. `labels`: each agent shows its code in the runtime's roster, its
 * project's letters and a number (figure-labels.ts), at its figure and on its
 * row; on unless turned off.
 */
/** When the usage gauges show: always, only while a provider is near its limit, or never. */
export type BoardMeters = "always" | "high" | "off";
/**
 * The stored choice. The key held "1" or "0" before it had three values, and
 * every save wrote it whether or not anyone chose, so an old value reads as
 * the default.
 */
export function parseBoardMeters(v: string | null): BoardMeters {
  return v === "always" || v === "off" ? v : "high";
}
/** `rename`: how often a Summary name is asked for again (shared/session-rename.ts); never unless chosen, since each is a model call. */
export type BoardPrefs = { corner: BoardCorner | null; inset: BoardInset | null; scoutbot: boolean; wide: boolean; look: BoardLook; folded: BoardFolded; foldedStyle: BoardFoldedStyle; names: BoardNames; namesBy: BoardNamesBy; rename: RenamePolicy; blink: boolean; meters: BoardMeters; dots: boolean; labels: boolean; /** How M and L order their rows (board-order.ts). */ order: BoardOrder; /** In a corner, or the notch on an edge (notch-model.ts). */ place: BoardPlace; notchEdge: NotchEdge };
const WIDE_KEY = "scout:companion:board-wide";
const FOLDED_KEY = "scout:companion:board-folded";
// Summary names became the default; the old key held "title" whether or not anyone chose it.
const NAMES_KEY = "scout:companion:names";
const FOLDED_STYLE_KEY = "scout:companion:board-folded-style";
const RENAME_KEY = "scout:companion:board-rename";
/** The page's own Blink flag (companion/main.tsx reads it too). */
const BLINK_KEY = "scout:companion:blink";
const LABELS_KEY = "scout:companion:figure-labels-shown";
const PLACE_KEY = "scout:companion:board-place";
const NOTCH_EDGE_KEY = "scout:companion:notch-edge";

export function readBoardPrefs(): BoardPrefs {
  try {
    return {
      corner: parseBoardCorner(window.localStorage.getItem(BOARD_CORNER_KEY)),
      inset: parseBoardInset(window.localStorage.getItem(BOARD_INSET_KEY)),
      // Pinned while they have no setting: Scoutbot shown, the board look, dots, no meters, names by the session's own harness.
      scoutbot: true,
      wide: window.localStorage.getItem(WIDE_KEY) === "1",
      look: "board",
      folded: parseBoardFolded(window.localStorage.getItem(FOLDED_KEY)),
      names: window.localStorage.getItem(NAMES_KEY) === "title" ? "title" : "summary",
      foldedStyle: window.localStorage.getItem(FOLDED_STYLE_KEY) === "stream" ? "stream" : "compact",
      namesBy: "harness",
      rename: parseRenamePolicy(window.localStorage.getItem(RENAME_KEY)),
      blink: window.localStorage.getItem(BLINK_KEY) === "1",
      meters: "off",
      dots: true,
      labels: window.localStorage.getItem(LABELS_KEY) !== "0",
      order: parseBoardOrder(window.localStorage.getItem(BOARD_ORDER_KEY)),
      place: parseBoardPlace(window.localStorage.getItem(PLACE_KEY)),
      notchEdge: parseNotchEdge(window.localStorage.getItem(NOTCH_EDGE_KEY)),
    };
  } catch {
    return { corner: null, inset: null, scoutbot: true, wide: false, look: "board", folded: DEFAULT_BOARD_FOLDED, foldedStyle: "compact", names: "summary", namesBy: "harness", rename: RENAME_NEVER, blink: false, meters: "off", dots: true, labels: true, order: "state", place: "corner", notchEdge: "top" };
  }
}

export function useBoardPrefs(): [BoardPrefs, (patch: Partial<BoardPrefs>) => void] {
  const [prefs, setPrefs] = useState(readBoardPrefs);
  const update = useCallback((patch: Partial<BoardPrefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        if (next.corner) window.localStorage.setItem(BOARD_CORNER_KEY, next.corner);
        if (next.inset) window.localStorage.setItem(BOARD_INSET_KEY, JSON.stringify(next.inset));
        else window.localStorage.removeItem(BOARD_INSET_KEY);
        window.localStorage.setItem(WIDE_KEY, next.wide ? "1" : "0");
        window.localStorage.setItem(FOLDED_KEY, next.folded);
        window.localStorage.setItem(NAMES_KEY, next.names);
        window.localStorage.setItem(FOLDED_STYLE_KEY, next.foldedStyle);
        window.localStorage.setItem(RENAME_KEY, formatRenamePolicy(next.rename));
        window.localStorage.setItem(BLINK_KEY, next.blink ? "1" : "0");
        window.localStorage.setItem(LABELS_KEY, next.labels ? "1" : "0");
        window.localStorage.setItem(BOARD_ORDER_KEY, next.order);
        window.localStorage.setItem(PLACE_KEY, next.place);
        window.localStorage.setItem(NOTCH_EDGE_KEY, next.notchEdge);
      } catch { /* private mode: keep it for this run */ }
      return next;
    });
  }, []);
  return [prefs, update];
}

const CORNER_LABEL: Record<BoardCorner, string> = {
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
};

const LOOK_LABEL: Record<FigureLook, string> = { "led-initials": "LED initials", "led-name": "LED name", character: "Character" };

/** Board: the companion's own flaps. Business: the app's theme (Settings › Look), plain type. Corners follow the app either way. */

/** One part of the sheet: its name over a card of rows. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="arv-set__sec">
      <h4>{title}</h4>
      <div className="arv-set__card">{children}</div>
    </section>
  );
}

/** One setting: its name, and a line on what it does, on the left; the choice on the right. */
function Row({ label, note, stacked = false, children }: { label: string; note?: ReactNode; stacked?: boolean; children?: ReactNode }) {
  return (
    <div className={`arv-set__row${stacked ? " is-stacked" : ""}`}>
      <span className="arv-set__key">{label}{note && <small>{note}</small>}</span>
      {children}
    </div>
  );
}

type Choice<T> = { value: T; text: string; title?: string; label?: string };

/** The policy after picking a mode: the same mode keeps its N; a new one starts at ten turns or ten minutes. */
function renameWith(current: RenamePolicy, every: RenamePolicy["every"]): RenamePolicy {
  if (every === current.every) return current;
  if (every === "never") return RENAME_NEVER;
  return { every, n: every === "turns" ? RENAME_TURNS[RENAME_TURNS.length - 1]! : RENAME_MINUTES[0]! };
}

/**
 * One project's code, kept by the runtime: its two or three letters, its
 * default shown when it has none of the operator's. A code another project
 * holds is refused by the runtime, which names the holder; the refusal shows
 * under the field, and the field keeps what was typed until Escape.
 */
function ProjectCode({ project, onSaved }: { project: RosterProjectRecord; onSaved: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const shown = project.codeSource === "default" ? "" : project.code ?? "";
  const commit = () => {
    if (draft === null || busy) return;
    const next = draft.trim() || null;
    if ((next ?? "") === shown) { setDraft(null); setRefused(null); return; }
    setBusy(true);
    setRuntimeProjectCode(project.name, next)
      .then(() => { setDraft(null); setRefused(null); onSaved(); })
      .catch((error: Error) => setRefused(error.message))
      .finally(() => setBusy(false));
  };
  return (
    <span className="arv-set__codeline">
      <label className="arv-set__code">
        <span title={project.name}>{project.name}</span>
        <input
          type="text"
          value={draft ?? shown}
          placeholder={project.code ?? projectDefaultCode(project)}
          maxLength={3}
          spellCheck={false}
          autoComplete="off"
          disabled={busy}
          aria-label={`Code for ${project.name}`}
          aria-invalid={refused ? true : undefined}
          onChange={(e) => { setDraft(draftProjectCode(e.currentTarget.value)); setRefused(null); }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(null); setRefused(null); e.currentTarget.blur(); } }}
        />
      </label>
      {refused && <small className="arv-set__refused" role="alert">{refused}</small>}
    </span>
  );
}

function ProjectCodes({ projects, onSaved }: { projects: readonly RosterProjectRecord[]; onSaved: () => void }) {
  return <span className="arv-set__codes">{projects.map((p) => <ProjectCode key={p.projectKey} project={p} onSaved={onSaved} />)}</span>;
}

/** A segmented choice, the current one pressed. */
function Seg<T extends string | number>({ label, value, choices, onPick }: { label: string; value: T; choices: readonly Choice<T>[]; onPick: (value: T) => void }) {
  return (
    <div className="arv-seg" role="group" aria-label={label}>
      {choices.map((c) => (
        <button key={String(c.value)} type="button" className={c.value === value ? "is-on" : undefined} aria-pressed={c.value === value} title={c.title} aria-label={c.label} onClick={() => onPick(c.value)}>{c.text}</button>
      ))}
    </div>
  );
}

/**
 * Where the board sits: the four corners as a small screen, its corner lit. A
 * board dragged off its corner lights none. Under them, Floating: the board on
 * the bottom edge, wherever it was slid to.
 */
/** The screen in small: its four corners, and a notch at the middle of each edge between them. */
const PLACE_GRID: readonly ({ corner: BoardCorner } | { edge: NotchEdge })[] = [
  { corner: "top-left" }, { edge: "top" }, { corner: "top-right" },
  { edge: "left" }, { edge: "right" },
  { corner: "bottom-left" }, { edge: "bottom" }, { corner: "bottom-right" },
];

function PlacePick({ corner, notch, dragged, floating, onPick, onNotch, onFloat }: {
  corner: BoardCorner; notch: NotchEdge | null; dragged: boolean; floating: boolean;
  onPick: (corner: BoardCorner) => void; onNotch: (edge: NotchEdge) => void; onFloat: (() => void) | null;
}) {
  return (
    <div className="arv-corners" role="group" aria-label="Position">
      {PLACE_GRID.map((spot) => {
        if ("edge" in spot) {
          const on = notch === spot.edge;
          const label = `Notch, ${NOTCH_EDGE_LABEL[spot.edge].toLowerCase()}`;
          return (
            <button key={spot.edge} type="button" className={`is-notch-${spot.edge}${on ? " is-on" : ""}`} aria-pressed={on} title={label} aria-label={label} onClick={() => onNotch(spot.edge)}>
              <i />
            </button>
          );
        }
        const c = spot.corner;
        const on = !notch && c === corner && !dragged && !floating;
        return (
          <button key={c} type="button" className={`is-${c}${on ? " is-on" : ""}`} aria-pressed={on} title={CORNER_LABEL[c]} aria-label={CORNER_LABEL[c]} onClick={() => onPick(c)}>
            <i />
          </button>
        );
      })}
      {onFloat && (
        <button type="button" className={`is-floating${floating ? " is-on" : ""}`} aria-pressed={floating} title="Floating" aria-label="Floating" onClick={onFloat}>
          <i />
        </button>
      )}
    </div>
  );
}

/** How attached agents land on the desk: the form new ones take, and the companion's figure look and defaults. */
function LandingSettings({ defaults }: { defaults: CompanionFigureDefaults }) {
  const form = useDefaultDeskForm();
  const look = useFigureLook();
  const fallback = useDeskCharacterDefault();
  const restLine = useDeskRestLine();
  const set = (patch: Partial<CompanionFigureDefaults>) => { void setCompanionFigureDefaults(patch).catch(() => {}); };
  return (
    <>
      <Row label="At rest" note="What an attached agent shows until you click it">
        <Seg label="At rest" value={restLine ? "line" : "state"} choices={[
          { value: "state", text: "Name and state" },
          { value: "line", text: "With its line", title: "Its latest line beside its name" },
        ]} onPick={(v) => setDeskRestLine(v === "line")} />
      </Row>
      <Row label="Land as" note="What a row becomes when you drag it off">
        <Seg label="Land as" value={form} choices={DESK_FORMS.map((f) => ({ value: f, text: DESK_FORM_LABEL[f] }))} onPick={setDefaultDeskForm} />
      </Row>
      <Row label="Figure">
        <Seg label="Figure" value={look} choices={FIGURE_LOOKS.map((l) => ({ value: l, text: LOOK_LABEL[l] }))} onPick={setFigureLook} />
      </Row>
      {look === "character" && CREW_ASSETS_AVAILABLE && (
        <Row label="No character" note="An agent with none of its own. Pick one per agent from its figure.">
          <Seg label="An agent with no character" value={fallback} choices={DESK_CHARACTER_DEFAULTS.map((d) => ({ value: d, text: DESK_CHARACTER_DEFAULT_LABEL[d] }))} onPick={setDeskCharacterDefault} />
        </Row>
      )}
      <Row label="Size">
        <Seg<number> label="Figure size" value={defaults.size} choices={FIGURE_SIZE_PRESETS.map((size) => ({ value: size, text: String(size), label: `${size} points` }))} onPick={(size) => set({ size })} />
      </Row>
      <Row label="Motion">
        <Seg label="Figure motion" value={defaults.motion} choices={FIGURE_MOTIONS.map((motion) => ({ value: motion, text: FIGURE_MOTION_LABEL[motion] }))} onPick={(motion) => set({ motion })} />
      </Row>
      <Row label="Hold" note="How a figure holds on to a window">
        <Seg label="Hold" value={defaults.hold} choices={FIGURE_HOLDS.map((hold) => ({ value: hold, text: FIGURE_HOLD_LABEL[hold] }))} onPick={(hold) => set({ hold })} />
      </Row>
    </>
  );
}

export function BoardSettings({ prefs, corner, floating = false, onFloat = null, placedCount, figureDefaults, overlay, canPlace, onPrefs, onOverlay, onSendBack, projects = [], roster = null }: {
  prefs: BoardPrefs;
  /** The runtime's records of the projects of the agents on the board now, for their codes. */
  projects?: readonly RosterProjectRecord[];
  /** The runtime's roster for this page: read it again after a change, and name agents in the import. Null for the demo. */
  roster?: { reload: () => void; nameOf: (agentId: string) => string | null; unavailable: string | null } | null;
  corner: BoardCorner;
  /** The companion floats (Settings › Companion): the board stands on the bottom edge. */
  floating?: boolean;
  /** Float the board; null without a host to keep the setting. */
  onFloat?: (() => void) | null;
  placedCount: number;
  /** The host's figure defaults: what an agent landing as a figure follows. null without a host to keep them (the preview): no landing controls. */
  figureDefaults: CompanionFigureDefaults | null;
  overlay: boolean;
  /** The page covers the display (edge mode), so the corner and plates are ours to draw. */
  canPlace: boolean;
  onPrefs: (patch: Partial<BoardPrefs>) => void;
  onOverlay: () => void;
  onSendBack: () => void;
}) {
  return (
    <div className="arv-set" onClick={(e) => e.stopPropagation()}>
      <Section title="Board">
        {canPlace && (<>
          <Row label="Position" note={prefs.place === "notch" ? "A notch at the middle of the edge, or drag it off the edge to stand it free" : floating ? "A corner, a notch on an edge, or slide the board along the bottom edge" : "A corner or a notch on an edge, or drag the board anywhere"}>
            <PlacePick corner={corner} notch={prefs.place === "notch" ? prefs.notchEdge : null} dragged={Boolean(prefs.inset)} floating={floating && prefs.place !== "notch"}
              onFloat={onFloat ? () => { onPrefs({ place: "corner" }); onFloat(); } : null}
              onPick={(c) => onPrefs({ corner: c, inset: null, place: "corner" })}
              onNotch={(e) => onPrefs({ place: "notch", notchEdge: e })} />
          </Row>
          {/* Off puts the board back where it stood before; On hangs it on the edge it last used. */}
          <Row label="Notch" note="Hidden, the pointer at its edge brings it out">
            <Seg label="Notch" value={prefs.place === "notch" ? "on" : "off"} choices={[{ value: "on", text: "On" }, { value: "off", text: "Off" }]}
              onPick={(v) => onPrefs({ place: v === "on" ? "notch" : "corner" })} />
          </Row>
        </>)}
        {canPlace && (
          <Row label="Blink" note="A new ask runs a light along the screen edge to the board">
            <Seg label="Blink" value={prefs.blink ? "on" : "off"} choices={[{ value: "on", text: "On" }, { value: "off", text: "Off" }]} onPick={(v) => onPrefs({ blink: v === "on" })} />
          </Row>
        )}
        <Row label="Labels" note="Each agent's code in the runtime's roster, OS 003: under its figure, on its row, and on its chest where the figure is big enough">
          <Seg label="Labels" value={prefs.labels ? "on" : "off"} choices={[{ value: "on", text: "Shown" }, { value: "off", text: "Off" }]} onPick={(v) => onPrefs({ labels: v === "on" })} />
        </Row>
      </Section>
      {roster && (
        <Section title="Roster">
          {roster.unavailable && <p className="arv-set__note">{roster.unavailable}</p>}
          {projects.length > 0 && (
            <Row label="Project codes" note="Two or three letters each, kept by the runtime. Empty gives the project its default." stacked>
              <ProjectCodes projects={projects} onSaved={roster.reload} />
            </Row>
          )}
          <RosterImport nameOf={roster.nameOf} onImported={roster.reload} />
          {!roster.unavailable && projects.length === 0 && <p className="arv-set__note">The runtime numbers each agent the first time it is active. Codes show here once agents on the board hold one.</p>}
        </Section>
      )}
      <Section title="Names">
        <Row label="Lines show">
          <Seg label="Names" value={prefs.names} choices={[
            { value: "title", text: "Session title", title: "The session's own title" },
            { value: "summary", text: "Summary", title: "A short name for the session's work, written by a cheap model" },
          ]} onPick={(names) => onPrefs({ names })} />
        </Row>
        {prefs.names === "summary" && (
          <>
            <Row label="Renamed" note="Each rename is one model call, made between turns">
              <Seg label="Renamed" value={prefs.rename.every} choices={[
                { value: "never", text: "Never", title: "Name each session once and keep it" },
                { value: "turns", text: "By turns", title: "Again after a number of finished turns" },
                { value: "minutes", text: "By time", title: "Again after some minutes, if a turn finished since" },
              ]} onPick={(every) => onPrefs({ rename: renameWith(prefs.rename, every) })} />
            </Row>
            {prefs.rename.every === "turns" && (
              <Row label="Every">
                <Seg label="Turns" value={prefs.rename.n} choices={RENAME_TURNS.map((n) => ({ value: n, text: `${n} turns` }))} onPick={(n) => onPrefs({ rename: { every: "turns", n } })} />
              </Row>
            )}
            {prefs.rename.every === "minutes" && (
              <Row label="Every">
                <Seg label="Minutes" value={prefs.rename.n} choices={RENAME_MINUTES.map((n) => ({ value: n, text: n % 60 === 0 ? `${n / 60} hour` : `${n} min` }))} onPick={(n) => onPrefs({ rename: { every: "minutes", n } })} />
              </Row>
            )}
          </>
        )}
      </Section>
      <Section title="Attached agents">
        {canPlace ? (
          <>
            <Row label="On screen" note={<><kbd>⌃⌥Space</kbd> shows and hides them. An asking agent always shows.</>}>
              <Seg label="Attached agents" value={overlay ? "shown" : "hidden"} choices={[{ value: "shown", text: "Shown" }, { value: "hidden", text: "Hidden" }]} onPick={(v) => { if ((v === "shown") !== overlay) onOverlay(); }} />
            </Row>
            <Row label="Attached" note={placedCount ? `${placedCount} on windows or the desk` : "None yet. Drag a row off the board to attach it."}>
              {placedCount > 0 && <button type="button" className="arv-set__btn" onClick={onSendBack}>Bring all back</button>}
            </Row>
            {figureDefaults && <LandingSettings defaults={figureDefaults} />}
          </>
        ) : (
          <p className="arv-set__note">Needs the companion on the full display (edge mode).</p>
        )}
      </Section>
    </div>
  );
}

/** Scoutbot beside the board: its panel, holding the open requests. */
export function ScoutbotBeside({ requests, now, style }: { requests: readonly OperatorAttentionItem[]; now: number; style: CSSProperties }) {
  const [bot, setBot] = useState<ScoutbotPrefs>(readScoutbotPrefs);
  const speech = useScoutbotSpeech();
  const onVoice = (voice: boolean) => setBot((b) => { const next = { ...b, voice }; writeScoutbotPrefs(next); return next; });
  return (
    <ScoutbotPanel
      name={bot.name}
      look={bot.look}
      status={requests.length ? `${requests.length} ${requests.length === 1 ? "request" : "requests"}` : "nothing waiting"}
      voice={bot.voice}
      speech={speech}
      readAloud={null}
      onVoice={onVoice}
      empty={requests.length === 0}
      style={style}
    >
      {[...requests].reverse().map((item) => <ScoutbotRequest key={item.id} item={item} now={now} />)}
    </ScoutbotPanel>
  );
}
