import type { CSSProperties } from "react";

/**
 * Rex's mark: the head from its app icon, facing right, with its scalloped
 * crest down the back and its mouth open at the front over a set-back jaw.
 * One filled shape with the eye cut out (evenodd), so it takes the color it is
 * drawn in like the other marks.
 */
export function RexMark({
  size = 14,
  className,
  style,
  title = "Rex",
}: {
  size?: number;
  className?: string;
  style?: CSSProperties;
  title?: string | null;
}) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      fillRule="evenodd"
      role={title ? "img" : undefined}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path
        d={[
          // dome and snout, then the upper lip back into the mouth's corner
          "M6.6 2.2C8.6 1 12.6 .9 14.6 3.1C15.9 4.6 15.9 7.3 14.8 8.5C13.5 9.4 11.4 9.7 9.9 9.6",
          // lower lip out to the jaw, round under the chin to the neck
          "L9.9 10.2C11 10.5 12.2 10.4 13 10C13.3 12.3 11.7 14.5 9.2 14.6C7.6 14.7 6.4 14.1 5.6 13.2",
          // the crest, bump by bump, back up to the crown
          "A.9 .9 0 0 1 4.4 11.6A.9 .9 0 0 1 3.9 9.8A.9 .9 0 0 1 3.8 7.9",
          "A.9 .9 0 0 1 4.1 6A.9 .9 0 0 1 4.8 4.3A.9 .9 0 0 1 5.6 3A.9 .9 0 0 1 6.6 2.2Z",
          // eye
          "M7.9 6.9a.75 1.05 0 1 0 1.5 0a.75 1.05 0 1 0 -1.5 0Z",
        ].join("")}
      />
    </svg>
  );
}
