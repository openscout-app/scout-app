import { describe, expect, test } from "bun:test";
import { MENU_LABEL, menuActions, type MenuFacts } from "./menu.ts";

const facts = (f: Partial<MenuFacts> = {}): MenuFacts => ({ file: false, agent: true, reachable: true, session: true, path: "a.png", ...f });
const labels = (f: MenuFacts) => menuActions(f).map((g) => g.map((a) => MENU_LABEL[a]));

describe("menuActions", () => {
  test("an artifact from a reachable session: Feedback first, then what its preview offers", () => {
    expect(labels(facts())).toEqual([["Feedback", "Open", "Ask Scoutbot about it"], ["Open session", "Copy path"]]);
  });
  test("a worked file also opens in Code", () => {
    expect(labels(facts({ file: true }))[1]).toEqual(["Open in Code", "Open session", "Copy path"]);
  });
  test("no Feedback when no reply can reach the session", () => {
    expect(menuActions(facts({ reachable: false }))[0]).toEqual(["open", "ask"]);
  });
  test("an item with no agent, or out of the window, only opens and copies", () => {
    expect(menuActions(facts({ agent: false, session: false }))).toEqual([["open"], ["copy"]]);
  });
  test("nothing to copy, no Copy path", () => {
    expect(menuActions(facts({ path: "" }))[1]).toEqual(["session"]);
  });
});
