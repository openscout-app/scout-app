import type { ComponentPropsWithoutRef } from "react";
import "../shell/surface-primitives.css";

export type ScoutActionButtonProps = ComponentPropsWithoutRef<"button"> & { quiet?: boolean };

export function ScoutActionButton({ quiet, className, type = "button", ...props }: ScoutActionButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={className ? `s-ds-btn ${className}` : "s-ds-btn"}
      data-quiet={quiet || undefined}
    />
  );
}
