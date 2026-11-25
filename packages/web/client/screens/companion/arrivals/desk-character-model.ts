import { assignCastSlug, CREW_ART, matchCastSlug } from "../../../lib/crew-registry.ts";
import { scopedValue, withScoped, type ScopeValues, type ScopeWho } from "./figure-scope-model.ts";

/*
 * Who draws an attached agent in the Character look. The operator picks for
 * this agent (its pin id) or for its project (figure-scope-model.ts): a crew
 * member, or the agent's own generative sprite. With no pick, the agent is
 * what the app says it is (Agents › the agent › Character, or a name that is
 * a crew member's). With neither, the default for every figure: its own
 * sprite, or a crew member handed out by its own seed (faceSeed), one each
 * while the crew lasts (crewHandout).
 *
 * Picks were once kept per handle, which every session of a harness shares,
 * so one pick drew all of them. They no longer draw anyone: once their agent
 * is seen, a pick moves to that one agent, or is dropped when several agents
 * carry the handle (adoptHandlePicks).
 */

/** The pick for an agent's own generative sprite. */
export const OWN_SPRITE = "sprite";
/** Per handle (the old picks): a crew slug, or OWN_SPRITE. */
export type DeskCharacters = Readonly<Record<string, string>>;
/** What an agent with no character of its own draws as. */
export type DeskCharacterDefault = "sprite" | "crew";
export const DEFAULT_DESK_CHARACTER: DeskCharacterDefault = "sprite";
export const DESK_CHARACTER_DEFAULTS: readonly DeskCharacterDefault[] = ["sprite", "crew"];
export const DESK_CHARACTER_DEFAULT_LABEL: Record<DeskCharacterDefault, string> = { sprite: "Own sprite", crew: "Crew member" };
export type DeskCharacterChoice = {
  /** Picks for one agent and for one project. */
  picks: ScopeValues<string>;
  /** Old picks by handle, kept only until they are adopted or dropped; they draw no one. */
  legacy: DeskCharacters;
  fallback: DeskCharacterDefault;
  /** The crew members the desk hands out by default, by face seed (crewHandout); absent, each seed's own. */
  handout?: ReadonlyMap<string, string>;
};
/** Where an agent's character comes from, most specific first. */
export type DeskCharacterSource = "agent" | "project" | "app" | "default";

/** A crew slug as it is drawn, or OWN_SPRITE; anything else is no pick. */
export function validPick(value: unknown): value is string {
  if (value === OWN_SPRITE) return true;
  return typeof value === "string" && matchCastSlug(value) === value;
}

/** The old per-handle picks. */
export function parseDeskCharacters(raw: string | null): DeskCharacters {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const picks: Record<string, string> = {};
    for (const [handle, value] of Object.entries(parsed)) {
      if (handle && validPick(value)) picks[handle] = value;
    }
    return picks;
  } catch {
    return {};
  }
}

export function parseDeskCharacterDefault(raw: string | null): DeskCharacterDefault {
  return raw === "crew" ? "crew" : DEFAULT_DESK_CHARACTER;
}

/** One agent's or one project's pick; null follows the next level again. Unchanged picks keep their identity. */
export function withDeskCharacter(picks: ScopeValues<string>, level: "agent" | "project", key: string, pick: string | null): ScopeValues<string> {
  return withScoped(picks, level, key, pick === null || !validPick(pick) ? null : pick);
}

/** Who a character is looked up for: its pin and project, and what its face is seeded by (faceSeed). */
export type DeskCharacterWho = ScopeWho & { seed: string };

/**
 * The crew slug that draws this agent (undefined for its own sprite) and
 * where it comes from: its pick, its project's, what the app resolved
 * (`matched`), else the default, handed out by its own seed.
 */
export function deskCharacterResolve(choice: DeskCharacterChoice, who: DeskCharacterWho, matched: string | undefined): { slug: string | undefined; from: DeskCharacterSource } {
  const set = scopedValue(choice.picks, who);
  if (set) return { slug: set.value === OWN_SPRITE ? undefined : set.value, from: set.from };
  if (matched) return { slug: matched, from: "app" };
  return { slug: choice.fallback === "crew" && who.seed ? choice.handout?.get(who.seed) ?? assignCastSlug(who.seed) : undefined, from: "default" };
}

/**
 * The crew members the desk hands out by default, one per agent while the
 * crew lasts: each seed takes its own member (assignCastSlug), else the next
 * one free, in the order given (the order its figure came out, by its
 * number), so an agent already out keeps its member when another comes out.
 * More agents than members: the rest take their own, shared.
 */
export function crewHandout(seeds: readonly string[], slugs: readonly string[] = Object.keys(CREW_ART)): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const seed of seeds) {
    if (!seed || out.has(seed)) continue;
    const own = assignCastSlug(seed);
    const start = Math.max(0, slugs.indexOf(own));
    // With every member out, it shares: its own member when that is in the crew, else the one it would have started from.
    let slug = slugs.includes(own) ? own : slugs[start] ?? own;
    for (let i = 0; i < slugs.length; i++) {
      const next = slugs[(start + i) % slugs.length]!;
      if (!taken.has(next)) { slug = next; break; }
    }
    taken.add(slug);
    out.set(seed, slug);
  }
  return out;
}

/** Two hand-outs that give every seed the same member. */
export function sameHandout(a: ReadonlyMap<string, string> | undefined, b: ReadonlyMap<string, string> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const [seed, slug] of a) if (b.get(seed) !== slug) return false;
  return true;
}

export function deskCharacterOf(choice: DeskCharacterChoice, who: DeskCharacterWho, matched: string | undefined): string | undefined {
  return deskCharacterResolve(choice, who, matched).slug;
}

/**
 * Settle old handle picks once their agents are seen. A pick by handle drew
 * every agent with that handle; it now draws exactly one: when one agent
 * (one pin) in sight carries the handle, the pick becomes that agent's own,
 * unless it has one already. When several do, there is no telling which one
 * it meant, so it is dropped rather than spread. Never to a project or to
 * every figure. A handle with no agent in sight waits. Null when nothing
 * changes.
 */
export function adoptHandlePicks(
  picks: ScopeValues<string>,
  legacy: DeskCharacters,
  seen: readonly (ScopeWho & { handle: string })[],
): { picks: ScopeValues<string>; legacy: DeskCharacters } | null {
  let nextPicks = picks;
  let nextLegacy: Record<string, string> | null = null;
  for (const [handle, pick] of Object.entries(legacy)) {
    const ids = [...new Set(seen.filter((a) => a.handle === handle).map((a) => a.id))];
    if (!ids.length) continue;
    if (ids.length === 1 && !Object.hasOwn(nextPicks.agents, ids[0]!)) nextPicks = withScoped(nextPicks, "agent", ids[0]!, pick);
    nextLegacy ??= { ...legacy };
    delete nextLegacy[handle];
  }
  return nextLegacy ? { picks: nextPicks, legacy: nextLegacy } : null;
}
