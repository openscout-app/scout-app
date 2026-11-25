import { describe, expect, test } from "bun:test";
import { briefingSlides } from "./briefing-slides-model.ts";
import type { BriefingDetail, ObservationItem } from "./briefings-model.ts";

const observation = (text: string): ObservationItem => ({ text, references: [{ label: text, kind: "work", route: { view: "work", workId: text } }] });
const detail = (over: Partial<BriefingDetail> = {}): BriefingDetail => ({ id: "b1", title: "Daily brief", summary: "Archived summary.", recommendation: null, kind: "fleet-home", preparedAt: 1, createdAt: 1, ttlMs: 1, brief: null, observations: [], snapshot: null, call: null, markdown: null, ...over });

describe("briefing work slides", () => {
  test("canonical markdown recovers summaries missing from old structured archives", () => {
    const markdown = "## Findings\n### Attention · 8\nFirst work.\n- work: [First source](work/w1)\n### Risk · 6\nSecond work.\n### Progress · 4\nThird work.\n## Actions\n- [Open work](work/w1)";
    const result = briefingSlides(detail({ markdown, observations: [observation("Only structured finding.")] }));
    expect(result.slides.map((s) => s.excerpt)).toEqual(["First work.", "Second work.", "Third work."]);
    expect(result.slides[0]!.references[0]!.route).toEqual({ view: "work", workId: "w1" });
  });
  test("keeps the analyst's work order, at most three slides, with source routes intact", () => {
    const observations = ["First work.", "Second work.", "Third work.", "Fourth work."].map(observation);
    const result = briefingSlides(detail({ observations }));
    expect(result.total).toBe(4);
    expect(result.slides.map((s) => s.excerpt)).toEqual(["First work.", "Second work.", "Third work."]);
    expect(result.slides[0]!.references).toEqual(observations[0]!.references);
  });
  test("skips blanks and duplicates without padding a single summary", () => {
    const result = briefingSlides(detail({ observations: [observation("  "), observation("One work."), observation(" One   work. ")] }));
    expect(result.total).toBe(1);
    expect(result.slides).toHaveLength(1);
  });
  test("bounds excerpts and names shortening without inventing status", () => {
    const text = "The fix was approved. Merge status was not verified. It needs a follow-up.";
    const slide = briefingSlides(detail({ observations: [observation(text)] })).slides[0]!;
    expect(slide.excerpt).toBe("The fix was approved. Merge status was not verified.");
    expect(slide.shortened).toBe(true);
    expect(slide.excerpt).not.toContain("merged");
  });
  test("reads older step observations, then narration, then the archive summary", () => {
    const brief = { id: "b1", title: "", summary: "", recommendation: "", actions: [], steps: [{ id: "s1", label: "Project work", narration: "Recorded work.", route: { view: "projects" }, observations: [observation("Source evidence.")] }] };
    expect(briefingSlides(detail({ brief })).slides[0]!.excerpt).toBe("Source evidence.");
    delete (brief.steps[0] as { observations?: unknown }).observations;
    expect(briefingSlides(detail({ brief })).slides[0]!.references[0]!.route).toEqual({ view: "projects" });
    expect(briefingSlides(detail()).slides[0]!.excerpt).toBe("Archived summary.");
  });
  test("long unbroken text and empty archives stay bounded", () => {
    const result = briefingSlides(detail({ observations: [observation("x".repeat(2000))] }));
    expect(result.slides[0]!.excerpt.length).toBeLessThanOrEqual(421);
    expect(result.slides[0]!.title.length).toBeLessThanOrEqual(141);
    expect(briefingSlides(detail({ summary: "" })).slides).toEqual([]);
  });
});
