import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CREW_SHEETS, crewAssetUrl, edgePoseArt, poseAsset, type EdgePoseArt, type EdgePoseName } from "../../lib/crew-registry.ts";

/**
 * The page side of a figure standing up mid-chase (full motion). The chase
 * (window-chase.ts) reports which figures are drawn in a pose other than
 * their perch's; the surfaces that place figures (the companion and the desk)
 * draw that pose and, once a figure that stood is back on a perch, sit it
 * into it.
 */

/** The crew member's eye frames, when it has them. */
export function eyeSheet(slug: string | undefined) {
  return slug ? CREW_SHEETS[slug.toLowerCase()] : undefined;
}

/** Stances the chase reports, and a settle count per figure that sat back down. */
export function useChaseStances() {
  const [stances, setStances] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [reseats, setReseats] = useState<ReadonlyMap<string, number>>(() => new Map());
  const stancesRef = useRef(stances);
  // Committed at once: the chase writes the matching transform in the same frame.
  const onStances = useCallback((next: ReadonlyMap<string, string>) => {
    const back = [...stancesRef.current].filter(([id, pose]) => pose === "rest" && !next.has(id)).map(([id]) => id);
    stancesRef.current = next;
    flushSync(() => {
      setStances(next);
      if (back.length) setReseats((prev) => new Map([...prev, ...back.map((id) => [id, (prev.get(id) ?? 0) + 1] as const)]));
    });
  }, []);
  return { stances, reseats, onStances };
}

/**
 * What a placed figure draws: the stance the chase asked for when its art
 * exists, else the perch's pose. Also the facts the chase reads off the
 * button: the resting pose and its drawing, the offset from its contact
 * point to its feet standing, and where its eye frames are.
 */
export function chaseStance({ slug, resting, stance, size, edge }: {
  slug: string | undefined;
  resting: EdgePoseName | "rest";
  stance: string | undefined;
  size: number;
  /** The figure holds by its edge art (not an LED tile, not a plate). */
  edge: boolean;
}): { pose: EdgePoseName | "rest"; art: EdgePoseArt | undefined; data: Record<string, string | number | undefined> } {
  const asked = stance as EdgePoseName | "rest" | undefined;
  const pose = asked && edgePoseArt(slug, asked) ? asked : resting;
  const art = edge ? edgePoseArt(slug, pose) : undefined;
  const restingArt = edge ? edgePoseArt(slug, resting) : undefined;
  const standingArt = restingArt ? edgePoseArt(slug, "rest") : undefined;
  const up = restingArt && standingArt
    ? { x: (standingArt.contact[0] - restingArt.contact[0]) * size / restingArt.h, y: (standingArt.contact[1] - restingArt.contact[1]) * size / restingArt.h }
    : null;
  const sheet = art ? eyeSheet(slug) : undefined;
  return {
    pose,
    art,
    data: {
      "data-pose": art ? resting : undefined,
      "data-up-x": up ? Math.round(up.x * 100) / 100 : undefined,
      "data-up-y": up ? Math.round(up.y * 100) / 100 : undefined,
      "data-eyes": sheet ? crewAssetUrl(sheet.dir) : undefined,
      // What it sits back down into: the chase waits for it to decode first.
      "data-rest-art": art && slug ? crewAssetUrl(poseAsset(slug, resting)) : undefined,
    },
  };
}
