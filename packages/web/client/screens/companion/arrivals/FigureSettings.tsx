import {
  FIGURE_HOLDS,
  setCompanionFigure,
  setCompanionFigureDefaults,
  type CompanionFigure,
  type CompanionFigureDefaults,
  type CompanionFigureHold,
  type CompanionFigureMotion,
  type CompanionFigurePatch,
} from "../../../lib/companion-host.ts";
import { CAST_MEMBERS, CREW_ASSETS_AVAILABLE } from "../../../lib/crew-registry.ts";
import { CrewAvatar } from "../../../components/CrewAvatar.tsx";
import { agentSpriteProps, SpriteAvatar } from "../../../components/SpriteAvatar.tsx";
import type { CompanionRoster } from "../companion-roster.ts";
import { FIGURE_HOLD_LABEL, FIGURE_MOTION_LABEL, FIGURE_MOTIONS, FIGURE_SIZE_PRESETS, figureSize } from "../figure-model.ts";
import { FIGURE_LOOKS, figureLookOf, setFigureLook, setScopedFigureLook, useFigureLookChoice, type FigureLook } from "../led-figure/figure-look.ts";
import { faceSeed, type CornerThread } from "../system-corner/system-corner-model.ts";
import { castFrom, figureMotionChoice } from "./DeskPlates.tsx";
import { DESK_FORM_LABEL, DESK_FORMS, deskFormResolve, setDefaultDeskForm, setDeskForm, setProjectDeskForm, useDeskFormChoice, type DeskForm } from "./desk-form.ts";
import { OWN_SPRITE, setDeskCharacter, useDeskCharacterChoice } from "./desk-character.ts";
import { projectKey, scopeNote, type ScopeOrigin } from "./figure-scope-model.ts";

const LOOK_LABEL: Record<FigureLook, string> = { "led-initials": "LED initials", "led-name": "LED name", character: "Character" };

/*
 * An agent on the desk: how it is drawn, in its Details (the Tap in panel).
 * Size, Motion, Hold and the window-top pose are this conversation's own, on
 * the host's figure patch API. Under them, Shows as (Figure or Strip), Look
 * and Character: a change here is this conversation's alone. Its project, or
 * every figure, takes a value only when asked, with the quiet "for <project>"
 * or "for every figure" beside it (figure-scope-model.ts), never by itself.
 * A quiet note says where a value this conversation follows comes from, and
 * "reset" lets a value of its own go. Nothing here talks to the agent: the
 * engage panel a click opens holds no settings.
 */
export function FigureSettings({ t, figure: f, pins, defaults, cast }: {
  t: CornerThread;
  figure: CompanionFigure;
  pins: readonly CompanionFigure[];
  defaults: CompanionFigureDefaults;
  cast: CompanionRoster | null;
}) {
  const project = projectKey(t.project);
  const who = { id: f.workId, project };
  const looks = useFigureLookChoice();
  const forms = useDeskFormChoice();
  const characters = useDeskCharacterChoice();
  const size = figureSize(f, defaults);
  const { motion, everyFigure } = figureMotionChoice(f, pins, defaults);
  const presets = [...FIGURE_SIZE_PRESETS] as number[];
  const below = [...presets].reverse().find((preset) => preset < size);
  const above = presets.find((preset) => preset > size);
  const onTop = f.placement.kind === "window" && f.placement.side === "top";
  const patch = (p: CompanionFigurePatch) => { void setCompanionFigure(f.workId, p).catch(() => {}); };
  const forEveryFigure = (m: CompanionFigureMotion) => {
    void setCompanionFigureDefaults({ motion: m }).catch(() => {});
    for (const p of pins) if (p.motion !== null) void setCompanionFigure(p.workId, { motion: "default" }).catch(() => {});
  };

  // Shows as: this conversation's own, else its project's, else the form it landed as, else every figure's.
  const formNow = deskFormResolve(forms, who);
  const form: DeskForm = formNow.form;
  const formOwn = Object.hasOwn(forms.agents, who.id);
  const projectForm = project !== null && Object.hasOwn(forms.projects, project) ? forms.projects[project]! : undefined;
  /** After its project or every figure takes the value: the conversation follows them when it would look the same. */
  const formFollows = (next: Partial<typeof forms>) => deskFormResolve({ ...forms, ...next, agents: {} }, who).form === form;
  const formFor = {
    project: project !== null && projectForm !== form ? () => { setProjectDeskForm(project, form); if (formFollows({ projects: { ...forms.projects, [project]: form } })) setDeskForm(f.workId, null); } : null,
    every: forms.fallback !== form ? () => { setDefaultDeskForm(form); if (formFollows({ fallback: form })) setDeskForm(f.workId, null); } : null,
  };

  const lookNow = figureLookOf(looks, who);
  const look: FigureLook = lookNow.look;
  const lookOwn = Object.hasOwn(looks.scoped.agents, who.id);
  const projectLook = project !== null && Object.hasOwn(looks.scoped.projects, project) ? looks.scoped.projects[project]! : undefined;
  const lookFollows = (next: Partial<typeof looks>) => figureLookOf({ ...looks, ...next, scoped: { ...(next.scoped ?? looks.scoped), agents: {} } }, who).look === look;
  const lookFor = {
    project: project !== null && projectLook !== look ? () => { setScopedFigureLook("project", project, look); if (lookFollows({ scoped: { ...looks.scoped, projects: { ...looks.scoped.projects, [project]: look } } })) setScopedFigureLook("agent", f.workId, null); } : null,
    every: looks.fallback !== look ? () => { setFigureLook(look); if (lookFollows({ fallback: look })) setScopedFigureLook("agent", f.workId, null); } : null,
  };

  // Who draws it: Auto follows its project's pick, its character in Agents, else every figure's default; its own sprite; or a crew member.
  const charNow = castFrom(cast, t, characters);
  const pick = characters.picks.agents[who.id] ?? null;
  const projectPick = project !== null ? characters.picks.projects[project] ?? null : null;
  const inherited = castFrom(cast, t, { ...characters, picks: { agents: {}, projects: characters.picks.projects } });
  const autoName = inherited.slug ? CAST_MEMBERS.find((m) => m.slug === inherited.slug)?.name ?? inherited.slug : "its own sprite";
  const choose = (value: string | null) => setDeskCharacter("agent", f.workId, value);
  const pickFor = project !== null && pick !== null && projectPick !== pick ? () => { setDeskCharacter("project", project, pick); setDeskCharacter("agent", f.workId, null); } : null;

  // Where a value this conversation follows comes from; a value of its own can be let go (Character lets go with Auto).
  const note = (from: ScopeOrigin, holds: boolean, clear?: () => void) => {
    const n = scopeNote("agent", from, project, holds);
    if (!n) return null;
    const reset = n.reset && clear
      ? <button type="button" className="arv-plate__link" title="Let this conversation's own go: follow its project, or every figure, again" onClick={clear}>reset</button>
      : null;
    return <>{n.text && <span className="arv-plate__from">{n.text}</span>}{reset}</>;
  };
  // The explicit wider levels: quiet links, set only when pressed.
  const wider = (to: { project?: (() => void) | null; every?: (() => void) | null }) => (
    <>
      {to.project && <button type="button" className="arv-plate__link" title={`Every conversation in ${project} that has no setting of its own`} onClick={to.project}>for {project}</button>}
      {to.every && <button type="button" className="arv-plate__link" title="Every figure with no setting of its own or its project's" onClick={to.every}>for every figure</button>}
    </>
  );

  return (
    <div className="arv-plate__set tap-figure" role="group" aria-label={formNow.form === "figure" ? "This figure" : "This strip"}>
      {formNow.form === "figure" && (
        <span className="arv-plate__cell"><i>Size</i>
          <span className="arv-plate__step">
            <button type="button" aria-label="Smaller" disabled={below === undefined} onClick={() => below !== undefined && patch({ size: below })}>&minus;</button>
            <b title={f.size === null ? "Default size" : undefined}>{size}</b>
            <button type="button" aria-label="Larger" disabled={above === undefined} onClick={() => above !== undefined && patch({ size: above })}>+</button>
          </span>
        </span>
      )}
      <span className="arv-plate__cell"><i>Motion</i>
        <span className="arv-plate__step" role="radiogroup" aria-label="Motion">
          {FIGURE_MOTIONS.map((option) => (
            <button key={option} type="button" role="radio" aria-checked={motion === option} onClick={() => patch({ motion: option })}>{FIGURE_MOTION_LABEL[option]}</button>
          ))}
        </span>
        {everyFigure && <button type="button" className="arv-plate__link" onClick={() => forEveryFigure(everyFigure)}>for every figure</button>}
      </span>
      <span className="arv-plate__cell"><i>Hold</i>
        <select aria-label="How it holds on" value={f.hold ?? "default"} onChange={(e) => patch({ hold: e.target.value as CompanionFigureHold | "default" })}>
          <option value="default">Default</option>
          {FIGURE_HOLDS.map((hold) => <option key={hold} value={hold}>{FIGURE_HOLD_LABEL[hold]}</option>)}
        </select>
        {onTop && (
          <select aria-label="On the window top" value={f.windowTop ?? "sit"} onChange={(e) => patch({ windowTop: e.target.value as "hang" | "sit" })}>
            <option value="sit">Sit above</option>
            <option value="hang">Hang underneath</option>
          </select>
        )}
      </span>
      <span className="arv-plate__cell"><i>Shows as</i>
        <span className="arv-plate__step" role="radiogroup" aria-label="Shows as">
          {DESK_FORMS.map((option) => (
            <button key={option} type="button" role="radio" aria-checked={form === option} onClick={() => setDeskForm(f.workId, option)}>{DESK_FORM_LABEL[option]}</button>
          ))}
        </span>
        {note(formNow.from, formOwn, () => setDeskForm(f.workId, null))}
        {wider(formFor)}
      </span>
      {form === "figure" && (
        <span className="arv-plate__cell"><i>Look</i>
          <span className="arv-plate__step" role="radiogroup" aria-label="Look">
            {FIGURE_LOOKS.map((option) => (
              <button key={option} type="button" role="radio" aria-checked={look === option} onClick={() => setScopedFigureLook("agent", f.workId, option)}>{LOOK_LABEL[option]}</button>
            ))}
          </span>
          {note(lookNow.from, lookOwn, () => setScopedFigureLook("agent", f.workId, null))}
          {wider(lookFor)}
        </span>
      )}
      {form === "figure" && look === "character" && CREW_ASSETS_AVAILABLE && (
        <span className="arv-plate__cell is-cast"><i>Character</i>
          <span className="arv-plate__cast" role="radiogroup" aria-label="Character">
            <button type="button" role="radio" className="is-auto" aria-checked={pick === null} title={`Auto: ${autoName}`} onClick={() => choose(null)}>Auto</button>
            <button type="button" role="radio" aria-checked={pick === OWN_SPRITE} title="Its own sprite" aria-label="Its own sprite" onClick={() => choose(OWN_SPRITE)}>
              <SpriteAvatar name={faceSeed(t)} hue={agentSpriteProps({ harness: t.harness }).hue} size={20} />
            </button>
            {CAST_MEMBERS.map((m) => (
              <button key={m.slug} type="button" role="radio" aria-checked={pick === m.slug} title={`${m.name}, ${m.title}`} aria-label={m.name} onClick={() => choose(m.slug)}>
                <CrewAvatar slug={m.slug} name={m.name} size={20} badge={false} ring={false} />
              </button>
            ))}
          </span>
          {note(charNow.from, pick !== null)}
          {wider({ project: pickFor })}
        </span>
      )}
    </div>
  );
}
