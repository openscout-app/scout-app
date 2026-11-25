import { describe, expect, test } from "bun:test";
import { validateDiagram } from "@hudsonkit/arc";
import { diffDiagram } from "@hudsonkit/arc";
import { canvasKindOf, embedOf, isArcItem, isArcPath } from "../../../shared/canvas.ts";
import { ARC_EMPTY, nextArc, readArc, type ArcValidate } from "./arc-source.ts";

const validate = validateDiagram as unknown as ArcValidate;

/** A small diagram Arc accepts: two nodes, one connector, one guided view. */
const diagram = (label = "Runtime") => ({
  layout: { width: 600, height: 300 },
  nodes: { runtime: { x: 60, y: 100, size: "m" }, web: { x: 360, y: 100, size: "m" } },
  nodeData: {
    runtime: { icon: "Server", name: label, color: "violet" },
    web: { icon: "Globe", name: "Web app", color: "blue" },
  },
  connectors: [{ from: "web", to: "runtime", fromAnchor: "left", toAnchor: "right", style: "call" }],
  connectorStyles: { call: { color: "zinc", strokeWidth: 2, label: "API" } },
  views: [{ id: "whole", title: "The whole", focus: ["runtime", "web"] }],
});

describe("Arc items", () => {
  test("a *.arc.json file is an embed, not a document", () => {
    expect(canvasKindOf("docs/diagrams/overview.arc.json")).toBe("embed");
    expect(canvasKindOf("docs/notes.md")).toBe("doc");
    expect(isArcPath("docs/diagrams/overview.arc.json")).toBe(true);
    expect(isArcPath("docs/OVERVIEW.ARC.JSON")).toBe(true);
    // other JSON is still not a card
    expect(canvasKindOf("package.json")).toBeNull();
    expect(isArcPath("arc.json")).toBe(false);
    expect(isArcPath("notes.arc.json.md")).toBe(false);
  });

  test("a shown file is an Arc embed by its source, not its show:<id> card path", () => {
    const shown = { kind: "embed" as const, path: "show:abc123", shown: { id: "abc123", itemId: "i1", source: "/repo/docs/overview.arc.json", listedIds: ["abc123"], versions: 1 } };
    expect(isArcItem(shown)).toBe(true);
    expect(isArcItem({ ...shown, shown: { ...shown.shown, source: "/repo/docs/notes.md" } })).toBe(false);
    expect(isArcItem({ kind: "embed", path: "~/dev/proj/overview.arc.json", embed: { provider: "arc" } })).toBe(true);
    expect(isArcItem({ kind: "image", path: "~/dev/proj/overview.arc.json" })).toBe(false);
    // a Shared copy saved while diagrams were documents still opens as the embed
    expect(embedOf({ kind: "doc", path: "~/dev/proj/overview.arc.json" })).toEqual({ provider: "arc" });
    expect(embedOf({ kind: "doc", path: "~/dev/proj/notes.md" })).toBeNull();
  });
});

describe("readArc", () => {
  test("reads a diagram Arc accepts", () => {
    const r = readArc(JSON.stringify(diagram()), validate);
    expect(r.ok).toBe(true);
  });

  test("a write in progress is not valid JSON yet, in one line", () => {
    const whole = JSON.stringify(diagram(), null, 2);
    const r = readArc(whole.slice(0, whole.length / 2), validate);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toStartWith("Not valid JSON yet:");
      expect(r.reason).not.toContain("\n");
    }
    expect(readArc("   ", validate)).toEqual({ ok: false, reason: "The file is empty." });
  });

  test("a diagram Arc refuses says what Arc said", () => {
    const bad = diagram();
    bad.connectors.push({ from: "web", to: "nowhere", fromAnchor: "left", toAnchor: "right", style: "call" });
    const r = readArc(JSON.stringify(bad), validate);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toStartWith("Arc refused it:");
    expect(readArc("[1, 2]", validate).ok).toBe(false);
  });

  test("a validator that throws is a reason, not a crash", () => {
    const r = readArc("{}", () => { throw new Error("boom"); });
    expect(r).toEqual({ ok: false, reason: "Arc could not read it: boom" });
  });
});

describe("nextArc keeps the last valid diagram", () => {
  test("valid, then a broken save, then valid again", () => {
    const first = nextArc(ARC_EMPTY, "v1", JSON.stringify(diagram("Runtime")), validate);
    expect(first).toMatchObject({ version: "v1", seen: "v1", problem: null });
    expect((first.data as ReturnType<typeof diagram>).nodeData.runtime.name).toBe("Runtime");

    // the agent is mid-write: the diagram stays, the reason shows, and v2 is not read again
    const broken = nextArc(first, "v2", "{\"layout\": {", validate);
    expect(broken.data).toBe(first.data);
    expect(broken.version).toBe("v1");
    expect(broken.seen).toBe("v2");
    expect(broken.problem).toStartWith("Not valid JSON yet:");

    // the save lands: the new label draws and the reason clears
    const fixed = nextArc(broken, "v3", JSON.stringify(diagram("Scout runtime")), validate, 1_700_000_000_000);
    expect(fixed).toMatchObject({ version: "v3", seen: "v3", problem: null, changedAt: 1_700_000_000_000 });
    expect((fixed.data as ReturnType<typeof diagram>).nodeData.runtime.name).toBe("Scout runtime");
    // the diagram it replaced is kept, past the broken save, for the marks
    expect(fixed.prev).toBe(first.data);
  });

  test("the kept diagram marks what the new one changed", () => {
    const first = nextArc(ARC_EMPTY, "v1", JSON.stringify(diagram("Runtime")), validate, 1);
    expect(first.prev).toBeNull();
    const grown = diagram("Scout runtime") as ReturnType<typeof diagram> & { nodes: Record<string, unknown>; nodeData: Record<string, unknown> };
    grown.nodes.cli = { x: 60, y: 220, size: "s" };
    grown.nodeData.cli = { icon: "Terminal", name: "CLI", color: "zinc" };
    const next = nextArc(first, "v2", JSON.stringify(grown), validate, 2);
    const delta = diffDiagram(next.prev as never, next.data as never);
    expect(delta.nodes.added).toEqual(["cli"]);
    expect(delta.nodes.changed.map((c) => c.id)).toEqual(["runtime"]);
  });

  test("a first read that is broken has no diagram, only the reason", () => {
    const s = nextArc(ARC_EMPTY, "v1", "not json", validate);
    expect(s.data).toBeNull();
    expect(s.version).toBeNull();
    expect(s.problem).toStartWith("Not valid JSON yet:");
  });
});
