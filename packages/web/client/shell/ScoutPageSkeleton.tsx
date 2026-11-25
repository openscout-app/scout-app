import { renderSkeletonMarkup, type ScoutRail, type ScoutSkeletonVariant } from "./boot-html.ts";
import "./skeleton.css";

export type { ScoutSkeletonVariant } from "./boot-html.ts";

export function ScoutPageSkeleton({
  variant,
  label,
  inline = false,
  rail,
}: {
  variant: ScoutSkeletonVariant;
  label?: string;
  inline?: boolean;
  rail?: ScoutRail;
}) {
  return (
    <div
      className="s-page-skeleton"
      data-skeleton-variant={variant}
      data-inline={inline || undefined}
      aria-busy="true"
      aria-label={label ?? `Loading ${variant}`}
      dangerouslySetInnerHTML={{ __html: renderSkeletonMarkup(variant, rail) }}
    />
  );
}
