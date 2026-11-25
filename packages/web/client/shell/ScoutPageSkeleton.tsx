import { renderSkeletonMarkup, type ScoutSkeletonVariant } from "./boot-html.ts";
import "./skeleton.css";

export type { ScoutSkeletonVariant } from "./boot-html.ts";

export function ScoutPageSkeleton({
  variant,
  label,
}: {
  variant: ScoutSkeletonVariant;
  label?: string;
}) {
  return (
    <div
      className="s-page-skeleton"
      data-skeleton-variant={variant}
      aria-busy="true"
      aria-label={label ?? `Loading ${variant}`}
      dangerouslySetInnerHTML={{ __html: renderSkeletonMarkup(variant) }}
    />
  );
}
