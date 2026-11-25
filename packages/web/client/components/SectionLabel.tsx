import type { ReactNode } from "react";
import "./section-rule.css";

export type LabelTier = "xs" | "sm" | "md" | "lg";

/**
 * The one section label: a size from the four label tiers (styles/primitives.css,
 * .label-xs .. .label-lg), at regular weight in --dim, in the voice's case and
 * tracking. SectionRule sets its label with it; a section that has no rule
 * (a list's group head, a card's eyebrow) uses it on its own.
 */
export function SectionLabel({
  tier = "lg",
  as: Tag = "span",
  className,
  children,
}: {
  tier?: LabelTier;
  as?: "span" | "h2" | "h3" | "h4" | "div";
  className?: string;
  children: ReactNode;
}) {
  const base = `label-${tier} scout-section-label`;
  return <Tag className={className ? `${base} ${className}` : base}>{children}</Tag>;
}
