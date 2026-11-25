import { describe, expect, test } from "bun:test";
import type { HerdrPaneProjection } from "@openscout/protocol";
import type { DiscoverySnapshot } from "@openscout/runtime/tail";
import { joinHerdrTailAttention } from "./herdr-host-attention.ts";

const pane = (sessionId: string | null, agent = "claude"): HerdrPaneProjection => ({
  paneId: "pane-1", terminalId: "term-1", tabId: "tab-1", workspaceId: "ws-1",
  label: "same-label", agent, agentStatus: "blocked",
  agentSession: sessionId ? { agent, kind: "id", source: "herdr", value: sessionId } : null,
  cwd: "/repo", foregroundCwd: "/repo", focused: false, scroll: null,
});
const snapshot = (): DiscoverySnapshot => ({
  generatedAt: 1, processes: [],
  transcripts: [{
    source: "claude", sessionId: "native", transcriptPath: "/native.jsonl",
    project: "repo", cwd: "/repo", harness: "unattributed", mtimeMs: 1, size: 1,
    attention: { kind: "ask", source: "registry", reason: "permission", since: 10 },
  }],
  totals: { total: 0, scoutManaged: 0, hudsonManaged: 0, unattributed: 0, transcripts: 1 },
});
describe("Herdr discovery attention", () => {
  test("joins the exact native id and harness to an exact host address, before registry", () => {
    const data = snapshot();
    expect(joinHerdrTailAttention(data, [{ session: "dev", pane: pane("native") }]).transcripts[0]?.attention)
      .toEqual({ kind: "ask", source: "herdr", since: null, reason: "Terminal is waiting for input (herdr:dev/pane-1)." });
    expect(data.transcripts[0]?.attention?.source).toBe("registry");
  });
  test("does not guess from cwd, labels, pane fallback, wrong harness or ambiguous identities", () => {
    for (const blocked of [
      [], [{ session: "dev", pane: pane(null) }], [{ session: "dev", pane: pane("other") }],
      [{ session: "dev", pane: pane("native", "codex") }],
      [{ session: "one", pane: pane("native") }, { session: "two", pane: pane("native") }],
    ]) {
      expect(joinHerdrTailAttention(snapshot(), blocked).transcripts[0]?.attention?.source).toBe("registry");
    }
  });
  test("a cleared pane does not retain earlier Herdr attention", () => {
    const data = snapshot();
    expect(joinHerdrTailAttention(data, [{ session: "dev", pane: pane("native") }]).transcripts[0]?.attention?.source).toBe("herdr");
    expect(joinHerdrTailAttention(data, []).transcripts[0]?.attention?.source).toBe("registry");
  });
});
