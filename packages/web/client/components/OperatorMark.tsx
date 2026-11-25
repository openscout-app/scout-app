import { useEffect, useState } from "react";
import { hostFetch } from "../lib/hosts/host-fleet.ts";
import { LedInitial } from "./LedInitial.tsx";
import "./initials-avatar.css";

/**
 * The operator, drawn as their GitHub profile photo when the host has a
 * GitHub login (GET /api/operator/avatar), else their initial on the LED
 * board. The photo is read once per page and shared by every placement.
 */

let photo: Promise<string | null> | null = null;

function operatorPhoto(): Promise<string | null> {
  photo ??= hostFetch("/api/operator/avatar", { credentials: "include" })
    .then(async (res) => (res.ok ? URL.createObjectURL(await res.blob()) : null))
    .catch(() => null);
  return photo;
}

export function OperatorMark({
  label,
  size,
  title,
}: {
  label: string | null | undefined;
  size: number;
  title?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void operatorPhoto().then((url) => { if (live) setSrc(url); });
    return () => { live = false; };
  }, []);

  if (!src) return <LedInitial label={label} size={size} title={title} />;
  return (
    <img
      className="scout-operator-photo"
      src={src}
      width={size}
      height={size}
      alt={title ?? label ?? "Operator"}
      title={title ?? label ?? undefined}
      onError={() => setSrc(null)}
    />
  );
}
