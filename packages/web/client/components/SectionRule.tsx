import type { ReactNode } from "react";
import { SectionLabel, type LabelTier } from "./SectionLabel.tsx";
import "./section-rule.css";

/**
 * The one way to divide a pane into sections: a label, an optional bare count,
 * a hairline that runs to the edge, and an optional right-hand note or
 * control. Panes are divided by the shell; items inside a section are rows
 * with a row hairline, never a box. See docs/design/tokens.md ("Separation").
 *
 * The label is a SectionLabel and a heading (h3 by default) so a pane's
 * sections are navigable. `id` makes the rule a scroll target.
 */
export function SectionRule({
  label,
  count,
  right,
  as = "h3",
  tier = "lg",
  id,
  className,
}: {
  label: ReactNode;
  count?: ReactNode;
  right?: ReactNode;
  as?: "h2" | "h3" | "h4" | "span";
  tier?: LabelTier;
  id?: string;
  className?: string;
}) {
  return (
    <div className={className ? `scout-section-rule ${className}` : "scout-section-rule"} id={id}>
      <SectionLabel as={as} tier={tier} className="scout-section-rule-label">{label}</SectionLabel>
      {count != null && count !== false && <span className="scout-section-rule-count">{count}</span>}
      <span className="scout-section-rule-line" aria-hidden />
      {right != null && right !== false && <span className="scout-section-rule-right">{right}</span>}
    </div>
  );
}
