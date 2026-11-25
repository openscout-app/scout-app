import { describe, expect, test } from "bun:test";
import { arcOutline, arcTitle, arcViews, EDITING_MS, idWords, isEditing, liveLine, pastLine, sinceLabel } from "./embed-model.ts";

describe("arcTitle", () => {
  test("the first view's title, else a top-level title, else the id as words; never a file name", () => {
    expect(arcTitle({ id: "scout-core", views: [{ id: "a", title: "  Arc on the  Canvas " }, { id: "b", title: "Second" }] })).toBe("Arc on the Canvas");
    expect(arcTitle({ id: "scout-core", title: "Scout core", views: [] })).toBe("Scout core");
    expect(arcTitle({ id: "arc-on-canvas", views: [] })).toBe("Arc on canvas");
    expect(arcTitle({ id: "arc-on-canvas", views: [{ id: "a", title: "" }] })).toBe("Arc on canvas");
    expect(idWords("commandRegistry_v2")).toBe("Command registry v2");
    expect(arcTitle({ layout: {} })).toBeNull();
    expect(arcTitle(null)).toBeNull();
    expect(arcViews({ views: [{}, {}, {}] })).toBe(3);
    expect(arcViews({})).toBe(0);
  });
});

describe("arcOutline", () => {
  test("names nodes, connections, views and flows, and leaves out layout and styling", () => {
    const outline = arcOutline({
      id: "web-app",
      layout: { width: 700, height: 300 },
      nodes: { client: { x: 50, y: 100, size: "l" }, api: { x: 300, y: 100, size: "m" }, db: { x: 520, y: 100, size: "m" } },
      nodeData: {
        client: { icon: "Monitor", name: "Client", subtitle: "React", color: "violet" },
        api: { icon: "Server", name: "API", subtitle: "Express", description: "REST endpoints", color: "emerald" },
        db: { icon: "Database", name: "Database", color: "blue" },
      },
      connectors: [
        { id: "client-api", from: "client", to: "api", fromAnchor: "right", toAnchor: "left", style: "http" },
        { from: "api", to: "db", fromAnchor: "right", toAnchor: "left", style: "sql", label: "queries" },
      ],
      connectorStyles: { http: { color: "amber", strokeWidth: 2, label: "HTTP" }, sql: { color: "blue", strokeWidth: 2 } },
      views: [{ id: "request", title: "A request", caption: "From the browser to the database" }],
      flows: [{ id: "req", label: "Request", legs: [{ id: "client-api" }, { from: "api", to: "db" }, { id: "client-api", direction: "reverse" }], color: "emerald" }],
    });
    expect(outline).toBe([
      "Title: A request",
      "Nodes (3):",
      "- client: Client (React)",
      "- api: API (Express) — REST endpoints",
      "- db: Database",
      "Connections (2):",
      "- Client → API: HTTP [client-api]",
      "- API → Database: queries",
      "Views (1):",
      "- A request — From the browser to the database",
      "Flows (1):",
      "- Request: Client → API, API → Database, API → Client",
    ].join("\n"));
    expect(outline).not.toMatch(/violet|strokeWidth|"x"|fromAnchor/);
  });

  test("is empty for what is not a diagram", () => {
    expect(arcOutline(null)).toBe("");
    expect(arcOutline([1, 2])).toBe("");
    expect(arcOutline({ layout: {} })).toBe("");
  });
});

describe("the live line", () => {
  const now = 1_000_000_000;
  test("says who is editing and when it last changed, from the real times", () => {
    expect(liveLine("Codex", "working", now - 8_000, now)).toBe("Codex is editing · changed 8s ago");
    expect(liveLine("Codex", "working", now - EDITING_MS - 1, now)).toBe("Codex · changed 3m ago");
    expect(liveLine("Codex", "quiet", now - 2 * 3600_000, now)).toBe("Codex · changed 2h ago");
    expect(liveLine(null, null, now - 90_000, now)).toBe("An earlier session · changed 1m ago");
    expect(liveLine("Codex", "working", null, now)).toBe("Codex · reading…");
  });

  test("from a past window it says which version it is, and never that the agent is editing", () => {
    expect(pastLine("Codex", true, now - 2 * 86400_000, now)).toBe("Codex · this version shown 2d ago");
    expect(pastLine("Codex", false, now - 3 * 3600_000, now)).toBe("Codex · the file as it is now, changed 3h ago");
    expect(pastLine(null, true, now - 8_000, now)).toBe("An earlier session · this version shown 8s ago");
    expect(pastLine("Codex", false, null, now)).toBe("Codex · reading…");
  });

  test("editing needs an agent at work and a recent change", () => {
    expect(isEditing("working", now, now)).toBe(true);
    expect(isEditing("asks", now, now)).toBe(false);
    expect(isEditing("working", null, now)).toBe(false);
    expect(sinceLabel(now + 5_000, now)).toBe("0s ago");
    expect(sinceLabel(now - 3 * 86400_000, now)).toBe("3d ago");
  });
});
