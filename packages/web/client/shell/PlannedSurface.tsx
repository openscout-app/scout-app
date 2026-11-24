import { onAppLinkClick } from "./navigation.ts";
import { capabilityLabels } from "./surface-catalog.ts";
import type { ScoutSurface } from "./surfaces.tsx";

/** A reserved surface. It says what is coming and points to what works today. */
export function PlannedSurface({ surface }: { surface: ScoutSurface }) {
  return (
    <section className="app-page app-planned" aria-labelledby="app-planned-title">
      <header className="app-pageHead">
        <h1 id="app-planned-title">{surface.label}</h1>
        <p className="app-pageNote">Not in this build yet</p>
      </header>
      <p className="app-plannedLead">{surface.description}</p>
      <p>
        {surface.label} is being extracted into Scout App next. Until it lands, this page shows no sample data. Feed is
        live now and reads the same local runtime.
      </p>
      <h2>When it ships</h2>
      <ul className="app-capabilities">
        {surface.capabilities.map(c => <li key={c}>{capabilityLabels[c]}</li>)}
      </ul>
      <a className="app-button" href="/feed" onClick={onAppLinkClick}>Open Feed</a>
    </section>
  );
}
