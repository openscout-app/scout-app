import { expect, test } from "bun:test";
import { parseFindings, splitMarkdownSections } from "./briefing-markdown.ts";

test("unknown sections cannot collide with inherited object properties", () => {
  expect(splitMarkdownSections("## constructor\nIgnore this.\n## __proto__\nAlso ignore.\n## Findings\n### Progress · 4\nWork done.").findings).toContain("Work done.");
});

test("all findings and the final actions section survive end of document", () => {
  const doc = "# Work brief\n## Headline\nWork moved.\n## Findings\n### Attention · 8\nFirst work.\n- agent: [Agent one](agents/a1)\n### Risk · 7\nSecond work.\n- work: [Work two](work/w2)\n### Risk · 6\nThird work.\n### Progress · 4\nLast work.\n## Recommendation\nReview the work.\n## Actions\n- [Open work](work/w2)";
  const sections = splitMarkdownSections(doc);
  expect(sections.actions).toBe("- [Open work](work/w2)");
  const findings = parseFindings(sections.findings);
  expect(findings.map((f) => f.text)).toEqual(["First work.", "Second work.", "Third work.", "Last work."]);
  expect(findings[1]!.references).toEqual([{ label: "Work two", href: "work/w2" }]);
});

test("empty headings never consume the next finding and bullets remain content", () => {
  const findings = parseFindings("### Risk · 8\n\n### Progress · 4\nThe work finished.\n- Verification remains pending.\n");
  expect(findings).toHaveLength(1);
  expect(findings[0]!.text).toBe("The work finished. - Verification remains pending.");
});
