import { ArrowLeft, ArrowRight, FileText } from "lucide-react";
import { useState } from "react";
import type { Route } from "../../lib/types.ts";
import { briefingSlides } from "./briefing-slides-model.ts";
import { referenceLabel, type BriefingDetail } from "./briefings-model.ts";

/* THESIS: a brief opens on the work, one source-backed excerpt at a time.
 * OWN-WORLD: existing Scout typography, neutral surfaces and source controls.
 * STORY: scan up to three work summaries, follow a source, read the full brief.
 * FIRST VIEWPORT: one readable slide above local navigation and disclosures.
 * FORM: a quiet, manual slide sequence; no autoplay or invented lifecycle. */
export function BriefingSlides({ detail, navigate }: { detail: BriefingDetail; navigate: (route: Route) => void }) {
  const { slides } = briefingSlides(detail);
  const [index, setIndex] = useState(0);
  const current = Math.min(index, slides.length - 1);
  const slide = slides[current];
  if (!slide) return null;
  return (
    <section className="briefing-deck" aria-label="Work summaries" aria-roledescription="carousel">
      <div className="briefing-deck-topline">
        <span>Work summaries</span>
      </div>
      <div className="briefing-slide" role="group" aria-roledescription="slide" aria-label={`${current + 1} of ${slides.length}`}>
        <h3>{slide.title}</h3>
        <p className="briefing-slide-excerpt">{slide.excerpt}</p>
        {slide.references.length ? (
          <div className="briefing-slide-sources" aria-label="Sources">
            {slide.references.slice(0, 3).map((reference, i) => reference.route ? (
              <button type="button" className="briefing-slide-source" key={i} onClick={() => navigate(reference.route as Route)}>
                <FileText size={16} aria-hidden="true" /><span>{referenceLabel(reference)}</span><ArrowRight size={14} aria-hidden="true" />
              </button>
            ) : <span className="briefing-slide-source" key={i}><FileText size={16} aria-hidden="true" /><span>{referenceLabel(reference)}</span></span>)}
          </div>
        ) : null}
      </div>
      <nav className="briefing-slide-nav" aria-label="Briefing slides">
        <span aria-live="polite" aria-atomic="true">{current + 1} / {slides.length}<span className="sr-only">: {slide.title}</span></span>
        {slides.length > 1 ? <>
          <button type="button" className="briefing-slide-control" aria-label="Previous work summary" disabled={current === 0} onClick={() => setIndex(current - 1)}><ArrowLeft size={16} aria-hidden="true" />Previous</button>
          <button type="button" className="briefing-slide-control" aria-label="Next work summary" disabled={current === slides.length - 1} onClick={() => setIndex(current + 1)}>Next<ArrowRight size={16} aria-hidden="true" /></button>
        </> : null}
      </nav>
    </section>
  );
}
