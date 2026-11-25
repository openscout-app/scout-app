import { describe, expect, test } from "bun:test";
import type { FleetAsk, FleetAttentionItem } from "../../lib/types.ts";
import { queueContent, summaryContent } from "./ops-panel-content.ts";

const need = (recordId: string, updatedAt: number) => ({ recordId, updatedAt }) as FleetAttentionItem;
const ask = (invocationId: string, startedAt: number | null, updatedAt: number) => ({ invocationId, startedAt, updatedAt }) as FleetAsk;

describe("Ops rail panel content", () => {
  test("Inbox · Active is empty with nothing waiting and nothing out", () => {
    expect(queueContent([], [])).toEqual({ empty: true, count: 0, state: "all clear", mark: undefined });
  });

  test("Inbox · Active reads what waits first, and marks the newest arrival", () => {
    const c = queueContent([need("w1", 50)], [ask("a1", 80, 90), ask("a2", null, 70)]);
    expect(c).toMatchObject({ empty: false, count: 1, state: "waiting", mark: "80" });
    expect(queueContent([], [ask("a1", 80, 90)])).toMatchObject({ empty: false, count: 1, state: "active" });
  });

  test("Ops summary is quiet with nothing waiting, out, working or picked", () => {
    expect(summaryContent({ needs: [], active: [], working: 0, picked: false })).toMatchObject({ empty: true, state: "quiet" });
    expect(summaryContent({ needs: [], active: [], working: 0, picked: true })).toMatchObject({ empty: false, state: "picked" });
    expect(summaryContent({ needs: [], active: [ask("a1", 10, 10)], working: 2, picked: false })).toMatchObject({ empty: false, state: "working", count: 2, mark: "10" });
  });
});
