import { describe, expect, test } from "bun:test";

import { chaseStance } from "./chase-stance.ts";

describe("chaseStance", () => {
  const seated = { slug: "sprout", resting: "sit-on-ledge" as const, size: 64, edge: true };

  test("on its perch it draws the perch's pose and tells the chase how to stand up from it", () => {
    const s = chaseStance({ ...seated, stance: undefined });
    expect(s.pose).toBe("sit-on-ledge");
    expect(s.art).toBeDefined();
    expect(s.data["data-pose"]).toBe("sit-on-ledge");
    // Standing puts its feet below the seat it sits on.
    expect(Number(s.data["data-up-y"])).toBeGreaterThan(0);
    expect(s.data["data-eyes"]).toBe("/crew/sheets/sprout");
    // What it sits back into, decoded before it does.
    expect(s.data["data-rest-art"]).toBe("/crew/edge-poses-v1/sprout/sit-on-ledge.webp");
  });

  test("mid-chase it draws the stance asked for and still reports the perch it rests in", () => {
    const s = chaseStance({ ...seated, stance: "rest" });
    expect(s.pose).toBe("rest");
    expect(s.data["data-pose"]).toBe("sit-on-ledge");
  });

  test("a stance without art, a figure without edge art, or one without a cast keeps its perch and asks for nothing", () => {
    expect(chaseStance({ ...seated, stance: "no-such-pose" }).pose).toBe("sit-on-ledge");
    const plate = chaseStance({ ...seated, stance: "rest", edge: false });
    expect(plate.art).toBeUndefined();
    expect(Object.values(plate.data).every((v) => v === undefined)).toBe(true);
    expect(Object.values(chaseStance({ ...seated, slug: undefined, stance: undefined }).data).every((v) => v === undefined)).toBe(true);
  });
});
