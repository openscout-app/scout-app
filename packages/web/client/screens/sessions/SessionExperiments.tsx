import { useEffect, useRef, useState } from "react";
import { useOptionalFeatureFlags, useOptionalFlag } from "hudsonkit/flags";
import { FlaskConical } from "lucide-react";
import "./session-interactions.css";

export const SESSION_EXPERIMENTS = [
  ["session.quote-reply", "Reply to selection", "Quote selected answer text into your draft."],
  ["session.prompt-navigation", "Prompt navigation", "Jump between your instructions in this transcript."],
  ["session.prompt-recall", "Prompt recall", "Use Up and Down in an empty composer to recall prompt text."],
  ["session.visual-replies", "Visual replies", "Preview complete HTML pages in answers. Scripts and external resources stay off."],
] as const;

export function useSessionExperiments() {
  return {
    quote: useOptionalFlag("session.quote-reply", false),
    navigation: useOptionalFlag("session.prompt-navigation", false),
    recall: useOptionalFlag("session.prompt-recall", false),
    visuals: useOptionalFlag("session.visual-replies", false),
  };
}

export function SessionExperiments() {
  const flags = useOptionalFeatureFlags();
  const root = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) root.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && root.current) { root.current.open = false; root.current.querySelector("summary")?.focus(); } };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", closeOutside); window.removeEventListener("keydown", escape); };
  }, [open]);
  if (!flags) return null;
  return <details ref={root} className="s-session-experiments" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary title="Session experiments" aria-label="Session experiments"><FlaskConical size={14} aria-hidden /></summary>
    <fieldset><legend>Session experiments</legend>
      {SESSION_EXPERIMENTS.map(([key, label, description]) => <label key={key} title={description}>
        <input type="checkbox" checked={flags.isEnabled(key)} onChange={(event) => flags.setLocalOverride(key, event.target.checked)} />
        <span>{label}<small>{description}</small></span>
      </label>)}
      <button type="button" onClick={() => SESSION_EXPERIMENTS.forEach(([key]) => flags.setLocalOverride(key, false))}>Turn all off</button>
    </fieldset>
  </details>;
}
