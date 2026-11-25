import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * One index, two homes: the rail on terminal deep links and the Terminals
 * panel on bare /terminal. Read as text, since importing .tsx pulls React
 * into bun test (see terminal-find.test.ts).
 */
describe("terminal index: rail and panel", () => {
  const index = readFileSync(new URL("./left.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../views/modules/terminal-index.tsx", import.meta.url), "utf8");

  test("the rail wrapper reads Scout context, so its callers stay unchanged", () => {
    expect(index).toContain("export function TerminalLeft() {");
    expect(index).toContain('<TerminalIndex route={route} navigate={navigate} variant="rail" />');
  });

  test("the index takes route and navigate as props; the active row follows the route it is given", () => {
    expect(index).toContain("export function TerminalIndex({ route, navigate, variant = \"rail\", bindFind");
    // agents come from context; route and navigate never do inside the index
    expect(index).toContain("const { agents } = useScout();");
    expect(index).not.toMatch(/function TerminalIndex[\s\S]*const \{[^}]*\broute\b[^}]*\} = useScout\(\)/);
  });

  test("\"/\" is bound by the rail, and by the panel only on a terminal's page, where no workspace takes it", () => {
    expect(index).toContain('bindFind = variant === "rail" }: TerminalIndexProps)');
    expect(index).toMatch(/useEffect\(\(\) => \{\s*if \(!bindFind\) return;\s*const onKeyDown/);
    expect(panel).toContain('bindFind={pageTerminal(route) != null}');
    expect(panel).not.toContain("addEventListener");
  });

  test("Enter and Observe are marked as the terminal reads its route: an agent named with no mode is entered", () => {
    expect(index).toContain('const openMode = route.view === "terminal" ? terminalMode(route) : null;');
    expect(index).not.toContain("route.mode ===");
  });

  test("the panel puts its count and Refresh in the panel head, not a second title", () => {
    expect(index).toContain("<ModuleHead>");
    expect(index).toContain('className="terminal-index-count"');
    expect(index).toMatch(/\{rail \? \(\s*<div className="terminal-nav-head">/);
  });

  test("row keys walk the index's own stops; the shared list helper finds none of its rows", () => {
    expect(index).not.toContain("useListArrowNav");
    expect(index).toContain("querySelectorAll<HTMLElement>(TERMINAL_INDEX_ROW_STOPS)");
    // every stop the selector names is a button the index draws
    for (const stop of ["terminal-nav-row-select", "terminal-nav-stopped", "terminal-nav-inactive-toggle"]) {
      expect(index).toMatch(new RegExp(`<button[^>]*?className="${stop}"`, "s"));
    }
  });

  test("a mount starts from what the index last held, not from empty", () => {
    expect(index).toContain("useState<TerminalIndexLoad>(() => seededIndexLoad(memory))");
    expect(index).toContain("() => seededHerdrSummaries(memory)");
    expect(index).toContain("useState<ReadonlySet<string>>(() => memory.expandedStopped)");
    expect(index).toContain("useState(() => memory.inactiveExpanded)");
    expect(index).toContain("useState(() => memory.agentsExpanded)");
    expect(index).toContain("rememberSessions(memory, sessions, Date.now())");
    expect(index).toContain("if (herdrReadFor(memory, sessions)) return;");
    expect(index).toContain("memory.scrollTop = event.currentTarget.scrollTop;");
    expect(index).toContain('scrollIntoView({ block: "nearest" })');
  });

  test("the module draws the panel variant at 3 × 24, never below 3 × 8", () => {
    expect(panel).toContain('type: "terminal-index"');
    expect(panel).toContain('title: "Terminals"');
    expect(panel).toContain('variant="panel"');
    expect(panel).toContain("size: { w: 3, h: 24 }");
    expect(panel).toContain("minSize: { w: 3, h: 8 }");
  });
});
