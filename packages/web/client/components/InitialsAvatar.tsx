import type { CSSProperties } from "react";
import { avatarInitials } from "../lib/avatar-initials.ts";
import "./initials-avatar.css";

/**
 * The Initials avatar: letters on a quiet neutral tile.
 *
 * Shape carries kind, letters carry identity, and nothing carries hue. A
 * project or agent is a square that takes the template's corner (rounded in
 * Rounded, square in Square); a person is a circle. The tile is ink mixed into
 * the surface, so a list of them reads as one set in every palette.
 */
export function InitialsAvatar({
  label,
  shape = "square",
  size,
  corner,
  cornerPulse,
  className,
  style,
  title,
}: {
  /** What the letters come from: a project name, an agent name, a person. */
  label: string | null | undefined;
  shape?: "square" | "circle";
  /** Fixed px box. Omit to fill the host, which then owns the box. */
  size?: number;
  /** A state dot in the corner (pass the color). */
  corner?: string;
  cornerPulse?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const letters = avatarInitials(label);
  const box: CSSProperties = size != null
    ? { width: size, height: size, fontSize: Math.max(7, Math.round(size * (letters.length > 1 ? 0.38 : 0.44))) }
    : {};
  return (
    <span
      className={`scout-initials${className ? ` ${className}` : ""}`}
      data-shape={shape}
      data-fill={size == null || undefined}
      data-letters={letters.length}
      style={{ ...box, ...style }}
      title={title ?? label ?? undefined}
      role="img"
      aria-label={title ?? label ?? letters}
    >
      <span className="scout-initials-letters" aria-hidden>{letters}</span>
      {corner ? (
        <span
          className="scout-initials-dot"
          data-pulse={cornerPulse || undefined}
          style={{ "--dot": corner } as CSSProperties}
          aria-hidden
        />
      ) : null}
    </span>
  );
}
