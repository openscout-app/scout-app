import { describe, expect, test } from "bun:test";
import { assignCastSlug } from "../../../lib/crew-registry.ts";
import { adoptHandlePicks, crewHandout, deskCharacterOf, deskCharacterResolve, OWN_SPRITE, parseDeskCharacterDefault, parseDeskCharacters, withDeskCharacter } from "./desk-character-model.ts";

const none = { agents: {}, projects: {} };
/** Who a character is looked up for: its pin, its project, and its own face seed. */
const who = (id: string, project: string | null, seed: string) => ({ id, project, seed });
/** An agent seen on the desk, for adopting old picks: its pin, its project, its handle. */
const seen = (id: string, project: string | null, handle: string) => ({ id, project, handle });

describe("desk characters", () => {
  test("this agent's pick wins over its project's, which wins over what the app matched", () => {
    const choice = { picks: { agents: { w1: "lulu", w2: OWN_SPRITE }, projects: { openscout: "vex" } }, legacy: {}, fallback: "crew" as const };
    expect(deskCharacterResolve(choice, who("w1", "openscout", "claude"), "milo")).toEqual({ slug: "lulu", from: "agent" });
    expect(deskCharacterOf(choice, who("w2", "openscout", "claude"), "milo")).toBeUndefined();
    expect(deskCharacterResolve(choice, who("w3", "openscout", "claude"), "milo")).toEqual({ slug: "vex", from: "project" });
    expect(deskCharacterResolve(choice, who("w4", "hudson", "claude"), "milo")).toEqual({ slug: "milo", from: "app" });
  });

  test("two sessions with the same handle are two agents: a pick for one leaves the other alone", () => {
    const picks = withDeskCharacter(none, "agent", "session:a", "lulu");
    const choice = { picks, legacy: {}, fallback: "sprite" as const };
    expect(deskCharacterOf(choice, who("session:a", "openscout", "claude"), undefined)).toBe("lulu");
    expect(deskCharacterOf(choice, who("session:b", "openscout", "claude"), undefined)).toBeUndefined();
  });

  test("with no pick, the app's character; with neither, the default, handed out by its own seed", () => {
    expect(deskCharacterOf({ picks: none, legacy: {}, fallback: "sprite" }, who("w", null, "Claude 0f10496b"), "milo")).toBe("milo");
    expect(deskCharacterOf({ picks: none, legacy: {}, fallback: "sprite" }, who("w", null, "Claude 0f10496b"), undefined)).toBeUndefined();
    expect(deskCharacterResolve({ picks: none, legacy: {}, fallback: "crew" }, who("w", null, "Claude 0f10496b"), undefined)).toEqual({ slug: assignCastSlug("Claude 0f10496b"), from: "default" });
  });

  test("the desk's hand-out wins over the seed's own member", () => {
    const handout = new Map([["Claude 0f10496b", "vex"]]);
    expect(deskCharacterOf({ picks: none, legacy: {}, fallback: "crew", handout }, who("w", null, "Claude 0f10496b"), undefined)).toBe("vex");
  });

  test("an old pick by handle draws no one: four sessions sharing a handle do not all turn into it", () => {
    const choice = { picks: none, legacy: { claude: "wrench" }, fallback: "sprite" as const };
    for (const id of ["0f10496b", "d158a9ca", "aa677b44", "edcc3d93"]) {
      expect(deskCharacterResolve(choice, who(`session:${id}`, "openscout", `Claude ${id}`), undefined)).toEqual({ slug: undefined, from: "default" });
    }
  });

  test("stored picks keep only crew members and the own sprite", () => {
    expect(parseDeskCharacters(JSON.stringify({ a: "lulu", b: OWN_SPRITE, c: "nobody", d: 3 }))).toEqual({ a: "lulu", b: OWN_SPRITE });
    expect(parseDeskCharacters("not json")).toEqual({});
    expect(parseDeskCharacterDefault("crew")).toBe("crew");
    expect(parseDeskCharacterDefault("other")).toBe("sprite");
  });

  test("a pick sets, clears, and leaves the picks alone when nothing changes", () => {
    const picks = withDeskCharacter(none, "agent", "a", "vex");
    expect(picks).toEqual({ agents: { a: "vex" }, projects: {} });
    expect(withDeskCharacter(picks, "agent", "a", "vex")).toBe(picks);
    expect(withDeskCharacter(picks, "agent", "a", null)).toEqual(none);
    expect(withDeskCharacter(picks, "agent", "a", "nobody")).toEqual(none);
    expect(withDeskCharacter(picks, "project", "openscout", "lulu").projects).toEqual({ openscout: "lulu" });
  });
});

describe("handing out crew members by default", () => {
  const slugs = ["milo", "lulu", "vex", "brik"];

  test("one each while the crew lasts, the same seed the same member", () => {
    const out = crewHandout(["a", "b", "c", "d"], slugs);
    expect(new Set(out.values()).size).toBe(4);
    expect(crewHandout(["a", "b", "c", "d"], slugs)).toEqual(out);
  });

  test("an agent already out keeps its member when another comes out", () => {
    const before = crewHandout(["a", "b"], slugs);
    const after = crewHandout(["a", "b", "c"], slugs);
    expect(after.get("a")).toBe(before.get("a")!);
    expect(after.get("b")).toBe(before.get("b")!);
  });

  test("more agents than members: the rest share", () => {
    const out = crewHandout(["a", "b", "c", "d", "e"], slugs);
    expect(out.size).toBe(5);
    expect(new Set(out.values()).size).toBe(4);
  });
});

describe("settling the picks once kept by handle", () => {
  test("a handle one agent in sight carries becomes that agent's own pick, never its project's", () => {
    const moved = adoptHandlePicks(none, { "agents-stations-haydn-7": "sprout" }, [seen("work-1", "openscout", "agents-stations-haydn-7"), seen("s3", "hudson", "codex")]);
    expect(moved).toEqual({ picks: { agents: { "work-1": "sprout" }, projects: {} }, legacy: {} });
  });

  test("a handle several agents share is dropped, not spread", () => {
    const moved = adoptHandlePicks(none, { claude: "wrench" }, [seen("session:a", "openscout", "claude"), seen("session:b", "demo-app", "claude"), seen("session:c", "openscout", "claude")]);
    expect(moved).toEqual({ picks: none, legacy: {} });
  });

  test("an agent with a pick of its own keeps it", () => {
    const moved = adoptHandlePicks({ agents: { s1: "vex" }, projects: {} }, { claude: "lulu" }, [seen("s1", null, "claude")]);
    expect(moved?.picks).toEqual({ agents: { s1: "vex" }, projects: {} });
  });

  test("a handle with no agent in sight waits; nothing moves, nothing resets", () => {
    expect(adoptHandlePicks(none, { claude: "lulu" }, [seen("s1", "openscout", "codex")])).toBeNull();
    const partly = adoptHandlePicks(none, { claude: "lulu", ada: OWN_SPRITE }, [seen("s1", "openscout", "claude")]);
    expect(partly?.legacy).toEqual({ ada: OWN_SPRITE });
  });
});
