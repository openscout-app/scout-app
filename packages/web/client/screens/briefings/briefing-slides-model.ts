import type { BriefingDetail, ReferenceItem } from "./briefings-model.ts";
import { parseFindings, routeForHref, routeKindForHref, splitMarkdownSections } from "../../../shared/briefing-markdown.ts";

export type BriefingSlide = {
  title: string;
  excerpt: string;
  shortened: boolean;
  references: ReferenceItem[];
};

function shorten(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const end = text.lastIndexOf(" ", limit);
  return `${text.slice(0, end > limit / 2 ? end : limit).trimEnd()}…`;
}

/** Excerpts from archived work, in the analyst's order. No inferred status or new model call. */
export function briefingSlides(detail: BriefingDetail): { slides: BriefingSlide[]; total: number } {
  const canonical = detail.markdown ? parseFindings(splitMarkdownSections(detail.markdown).findings) : [];
  const observations = canonical.length ? canonical.map((finding) => ({
    text: finding.text,
    references: finding.references.map((reference) => ({ label: reference.label, kind: routeKindForHref(reference.href), route: routeForHref(reference.href) ?? undefined })),
  })) : detail.observations.length
    ? detail.observations
    : detail.brief?.steps.flatMap((step) => step.observations ?? []) ?? [];
  let candidates = observations.map((item) => ({ text: item.text, title: item.references.find((reference) => /\s/.test(reference.label))?.label, references: item.references }));
  if (!candidates.some((item) => item.text.trim())) {
    candidates = (detail.brief?.steps ?? []).map((step) => ({
      text: step.narration, title: step.label,
      references: step.route ? [{ label: step.label, kind: "work", route: step.route }] : [],
    }));
  }
  if (!candidates.some((item) => item.text.trim())) {
    candidates = [{ text: detail.summary || detail.recommendation || "", title: detail.title, references: [] }];
  }
  const seen = new Set<string>();
  const unique = candidates.filter((item) => {
    const text = item.text.replace(/\s+/g, " ").trim();
    if (!text || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
  return {
    total: unique.length,
    slides: unique.slice(0, 3).map((item) => {
      const text = item.text.replace(/\s+/g, " ").trim();
      const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
      const title = item.title?.trim() || sentences[0]!;
      const excerpt = shorten(sentences.slice(0, 2).join(" "), 420);
      return { title: shorten(title, 140), excerpt, shortened: excerpt !== text || title.length > 140, references: item.references };
    }),
  };
}
