import type { ReactNode } from "react";
import { useTheme } from "hudsonkit/theme";
import type { ScoutBackdrop } from "../lib/theme.ts";
import { ScoutActionButton } from "../primitives/ScoutActionButton.tsx";
import type { ScoutRuntimeBadge, ScoutSetupCallout } from "./ScoutAppFrame.tsx";

export interface ScoutThinSettingsConfig {
  /** Route for the standard settings view (defaults to `/settings`). */
  route?: string;
  /** Optional app-specific settings sections rendered below Appearance and Runtime. */
  extra?: ReactNode;
}

const CORNER_OPTIONS = [
  { id: "hudson", label: "Rounded" },
  { id: "editorial", label: "Near-square" },
  { id: "drafting", label: "Square" },
] as const;

const BACKDROP_OPTIONS: ReadonlyArray<{ id: ScoutBackdrop; label: string }> = [
  { id: "plain", label: "Plain" },
  { id: "smooth", label: "Smooth" },
  { id: "dusk", label: "Dusk" },
  { id: "aurora", label: "Aurora" },
];

export function ScoutThinSettingsPanel({
  product,
  status,
  setupCallout,
  frameBackdrop,
  onFrameBackdropChange,
  extra,
}: {
  product: string;
  status?: ScoutRuntimeBadge | null;
  setupCallout?: ScoutSetupCallout | null;
  frameBackdrop?: ScoutBackdrop;
  onFrameBackdropChange?: (backdrop: ScoutBackdrop) => void;
  extra?: ReactNode;
}) {
  const { theme, setTheme, template, setTemplate } = useTheme();
  const title = product === "Scout" ? "Scout" : `Scout ${product}`;

  return (
    <div className="s-thin-settings s-surface-rail" data-rail="reading">
      <header className="s-thin-settings-head">
        <h1>Settings</h1>
        <p>Standard appearance, runtime connection, and workspace preferences for {title}.</p>
      </header>

      <section className="s-thin-settings-section" aria-labelledby="s-settings-appearance">
        <div className="s-thin-settings-row">
          <div>
            <h2 id="s-settings-appearance">Appearance</h2>
            <p>Choose how {title} matches your display.</p>
          </div>
          <div className="s-thin-settings-seg" role="radiogroup" aria-label="Color theme">
            <button
              type="button"
              role="radio"
              aria-checked={theme === "dark"}
              onClick={() => setTheme("dark")}
            >
              Dark
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === "light"}
              onClick={() => setTheme("light")}
            >
              Light
            </button>
          </div>
        </div>

        <div className="s-thin-settings-row">
          <div>
            <h2>Corners</h2>
            <p>Match the page sheet rounding used across Scout.</p>
          </div>
          <div className="s-thin-settings-seg" role="radiogroup" aria-label="Sheet corners">
            {CORNER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={template === opt.id}
                onClick={() => setTemplate(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {frameBackdrop && onFrameBackdropChange ? (
          <div className="s-thin-settings-row">
            <div>
              <h2>Frame</h2>
              <p>Tint behind the sidebar and top row around the page sheet.</p>
            </div>
            <div className="s-thin-settings-seg" role="radiogroup" aria-label="Frame backdrop">
              {BACKDROP_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={frameBackdrop === opt.id}
                  onClick={() => onFrameBackdropChange(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="s-thin-settings-section" aria-labelledby="s-settings-runtime">
        <div className="s-thin-settings-row">
          <div>
            <h2 id="s-settings-runtime">Scout runtime</h2>
            <p>{status?.detail || status?.label || "Local coordination runtime on this host."}</p>
          </div>
          {status ? (
            <span className="s-thin-status" data-tone={status.tone ?? "local"} role="status">
              <span className="s-thin-status-dot" aria-hidden="true" />
              <span>{status.label}</span>
            </span>
          ) : null}
        </div>
        {setupCallout ? (
          <div className="s-thin-settings-callout">
            <p>{setupCallout.description}</p>
            <div className="s-thin-setup-actions">
              <code className="s-thin-setup-cmd">{setupCallout.command}</code>
              {setupCallout.onAction ? (
                <ScoutActionButton onClick={setupCallout.onAction}>
                  {setupCallout.actionLabel ?? "Start runtime"}
                </ScoutActionButton>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      {extra ? (
        <section className="s-thin-settings-section">{extra}</section>
      ) : null}
    </div>
  );
}
