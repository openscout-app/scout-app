import { describe, expect, test } from "bun:test";

import type { ServiceGauge } from "../../home/HomeHero.tsx";
import { quotaGauges, quotaProviderOptions } from "./providers-model.ts";

const quota = (id: string): ServiceGauge => ({
  id,
  label: id,
  kind: "quota",
  fill: 0.25,
  usedLabel: "",
  capLabel: "",
  unitLabel: "",
  resetAt: 0,
});

const status = (id: string): ServiceGauge => ({ id, label: id, kind: "status", statusLabel: "Pro", tone: "ok" } as ServiceGauge);

describe("plan windows", () => {
  const gauges = [quota("claude-max"), quota("codex"), status("cursor"), quota("Claude Code weekly")];

  test("every quota gauge, or one provider's", () => {
    expect(quotaGauges(gauges, undefined).map((g) => g.id)).toEqual(["claude-max", "codex", "Claude Code weekly"]);
    expect(quotaGauges(gauges, "claude").map((g) => g.id)).toEqual(["claude-max", "Claude Code weekly"]);
    expect(quotaGauges(gauges, "cursor")).toEqual([]);
  });

  test("providers that report windows, once each, sorted", () => {
    expect(quotaProviderOptions(gauges, (id) => id.toUpperCase())).toEqual([
      { value: "claude", label: "CLAUDE" },
      { value: "codex", label: "CODEX" },
    ]);
  });
});
