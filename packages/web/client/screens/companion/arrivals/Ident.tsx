import { HarnessMark, harnessLabel, harnessTint, normalizeHarnessKey } from "../../../components/HarnessMark.tsx";
import type { CSSProperties } from "react";
import { boardCandidates } from "../../../components/ProjectMark.tsx";
import type { CornerThread } from "../system-corner/system-corner-model.ts";
import { rowName, rowWhere } from "./arrivals-model.ts";
import { figureLabelText, type FigureLabel } from "./figure-labels.ts";

/* Who a board row or plate is (Studio /studies/companion-board-ii). */

/** Project mark, harness coin, agent: who the row is, at the size of the rest; its roster label. */
export function Ident({ t, size = 18, label }: { t: CornerThread; size?: number; label?: FigureLabel }) {
  const name = rowName(t);
  return (
    <span className="arv-id">
      <Marks project={t.project} harness={t.harness} agent={t.handle} size={size} />
      <b className="arv-name">{name}</b>
      <LabelTag label={label} />
    </span>
  );
}

/** An agent's code in the runtime's roster (figure-labels.ts), "OS 003": quiet, small, mono, the same under its figure and on its row. */
export function LabelTag({ label }: { label: FigureLabel | null | undefined }) {
  if (!label) return null;
  return <span className="arv-tag">{figureLabelText(label)}</span>;
}

/**
 * A call sign in plain type, for legibility: the project's code over the
 * number in a row's tile ("HD" over "004"), or one line with its dash
 * ("OS-003") before a strip line's name. The dot-matrix CallSignMark
 * (ProjectMark.tsx) is kept for another look; the board does not use it.
 */
export function CallSign({ sign, stacked = true, className }: { sign: string; stacked?: boolean; className?: string }) {
  const [code = "", num = ""] = sign.split("-");
  return (
    <span className={`arv-callsign${stacked ? " is-stacked" : ""}${className ? ` ${className}` : ""}`} role="img" aria-label={sign}>
      {stacked ? <><b aria-hidden="true">{code}</b><b aria-hidden="true">{num}</b></> : <b aria-hidden="true">{sign}</b>}
    </span>
  );
}

/** Two letters in the board's existing face, never an invented project name. */
export function identityMonogram(name: string): string {
  const clean = name.trim().replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  // OpenScout is commonly stored as the all-lowercase checkout basename.
  return clean.toLowerCase() === "openscout" ? "OS" : boardCandidates(clean || "Agent")[0]!;
}

/** A project's letters in plain type on a hairline tile, at the tile's size (the dot-matrix ProjectMark is kept for another look). */
function codeTile(size: number): CSSProperties {
  return { width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.5)) };
}

/**
 * Both slots always have content. Unknown identities are a quieter monogram/coin.
 * A known harness's coin wears its brand tint (harnessTint), when it has one.
 * With a call sign (OPN-042) the tile spells it in type, stacked, in place of the
 * project's two letters: a row two lines tall.
 */
export function Marks({ project, harness, agent = "Agent", size = 16, sign }: { project: string | null | undefined; harness: string | null | undefined; agent?: string; size?: number; sign?: string | null }) {
  const knownProject = project?.trim();
  const knownHarness = normalizeHarnessKey(harness) === "unknown" ? null : harness?.trim();
  const fallback = agent.trim() || "Agent";
  const tint = knownHarness ? harnessTint(knownHarness) : null;
  return (
    <span className="arv-marks">
      {knownProject && sign
        ? <span className="arv-tile is-sign" title={`${sign}, ${knownProject}`}><CallSign sign={sign} /></span>
        : knownProject
        ? <span className="arv-tile is-code" style={codeTile(size)} title={knownProject} role="img" aria-label={knownProject}>{identityMonogram(knownProject)}</span>
        : <span className="arv-tile is-code is-fallback" style={codeTile(size)} title={`Project unknown · ${fallback} monogram`} role="img" aria-label={fallback}>{identityMonogram(fallback)}</span>}
      {knownHarness
        ? <span className={`arv-coin${tint ? " is-tinted" : ""}`} style={tint ? ({ "--arv-coin-tint": tint } as CSSProperties) : undefined} title={harnessLabel(knownHarness)}><HarnessMark harness={knownHarness} size={9} title={null} /></span>
        : <span className="arv-coin is-fallback" role="img" aria-label="Harness unknown" title="Harness unknown"><svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true"><circle cx="4.5" cy="4.5" r="1.25" fill="currentColor" /></svg></span>}
    </span>
  );
}

/** Where it works: project · branch, else what it is about, never what the name already says. */
export function sessionLine(t: CornerThread): string {
  return rowWhere(t);
}

