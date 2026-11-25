import { describe, expect, test } from "bun:test";

import type { WorkMaterialContent } from "../../lib/types.ts";
import { createMaterialReader } from "./work-material-content.ts";

const file = (content: string) => ({ workId: "w", materialId: "m", path: "a.ts", content, truncated: false }) as WorkMaterialContent;

function server(...replies: Array<string | Error>) {
  const reads: string[] = [];
  const fetch = async (workId: string, materialId: string) => {
    reads.push(`${workId}/${materialId}`);
    const reply = replies.shift();
    if (reply === undefined || reply instanceof Error) throw reply ?? new Error("no reply");
    return file(reply);
  };
  return { reads, fetch };
}

describe("createMaterialReader", () => {
  test("shares a read in flight and reuses a recent one", async () => {
    const { reads, fetch } = server("one");
    const reader = createMaterialReader(fetch, { freshMs: 1_000 });
    const [first, second] = await Promise.all([reader.read("w", "m", 0), reader.read("w", "m", 0)]);
    expect(await reader.read("w", "m", 999)).toBe(first);
    expect(second).toBe(first);
    expect(reads).toEqual(["w/m"]);
  });

  test("shows the last content while it reads an older file again, and keeps an unchanged file's object", async () => {
    const { reads, fetch } = server("one", "one", "two");
    const reader = createMaterialReader(fetch, { freshMs: 1_000 });
    const first = await reader.read("w", "m", 0);
    const again = reader.read("w", "m", 1_000);
    expect(reader.peek("w", "m")).toBe(first);
    expect(await again).toBe(first);
    expect((await reader.read("w", "m", 2_000)).content).toBe("two");
    expect(reader.peek("w", "m")?.content).toBe("two");
    expect(reads).toHaveLength(3);
  });

  test("forgets a failed first read and keeps the last content after a failed read again", async () => {
    const { reads, fetch } = server(new Error("offline"), "one", new Error("offline"));
    const reader = createMaterialReader(fetch, { freshMs: 1_000 });
    await expect(reader.read("w", "m", 0)).rejects.toThrow("offline");
    expect(reader.peek("w", "m")).toBeNull();
    const first = await reader.read("w", "m", 0);
    await expect(reader.read("w", "m", 1_000)).rejects.toThrow("offline");
    expect(reader.peek("w", "m")).toBe(first);
    expect(reads).toHaveLength(3);
  });

  test("keeps only the most recent files", async () => {
    const { reads, fetch } = server("a", "b", "c", "a");
    const reader = createMaterialReader(fetch, { max: 2 });
    for (const id of ["a", "b", "c", "a"]) await reader.read("w", id, 0);
    expect(reads).toEqual(["w/a", "w/b", "w/c", "w/a"]);
  });
});
