import { describe, expect, test } from "bun:test";

import { durationWords, failureWords } from "./swarm-failure.ts";

describe("failureWords", () => {
  test("names the provider's filter and keeps its code", () => {
    expect(failureWords(
      "This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing your request. If you’re doing authorized security work that requires more cyber permissive safeguards, apply for Daybreak access via https://platform.openai.com/settings/organization/status-and-access before retrying. (cyberPolicy)",
    )).toBe("Refused by the provider's cybersecurity filter (cyberPolicy)");
  });

  test("reads a provider's message as its first sentence and its code", () => {
    expect(failureWords("Selected model is at capacity. Please try a different model. (serverOverloaded)"))
      .toBe("Selected model is at capacity (serverOverloaded)");
    expect(failureWords("Rate limited (usageLimitExceeded)")).toBe("Rate limited (usageLimitExceeded)");
  });

  test("says why the session never started", () => {
    expect(failureWords("Endpoint resolution failed before execution: session session-abc123-def456 is not currently reachable"))
      .toBe("Its session was not reachable");
    expect(failureWords("Endpoint resolution failed before execution: session edbe0f47-8956-4c65-b128-af5739bd0c50 is not currently reachable"))
      .toBe("Its session was not reachable");
    expect(failureWords("Endpoint resolution failed before execution: Timed out after 30000ms waiting for Codex app-server startup."))
      .toBe("Codex's app server did not start within 30 s");
    expect(failureWords("Endpoint resolution failed before execution: no endpoint serves this harness. Install it first."))
      .toBe("No endpoint serves this harness");
  });

  test("says why the runtime closed a flight still marked running", () => {
    expect(failureWords("Stale running flight reconciled: endpoint endpoint.session-abc.host-one.tmux moved to offline at 1792723280126"))
      .toBe("The runtime closed it when its session went offline");
    expect(failureWords(
      "Stale running flight reconciled: endpoint endpoint.session-abc.host-one.codex_app_server was replayed active for invocation inv-request-987e without a live broker task",
    )).toBe("No live task was running it, so the runtime closed it");
    expect(failureWords("Stale running flight reconciled: superseded by newer completed flight flt-mvj67bxo-vk72k2"))
      .toBe("A newer flight replaced it");
    expect(failureWords("Stale running flight reconciled: no heartbeat")).toBe("The runtime closed it as stale");
  });

  test("reads the runtime's own failures without its internals", () => {
    expect(failureWords("Timed out waiting for local agent turn after 3600000ms.")).toBe("Timed out after 1 h");
    expect(failureWords("Local target session-abc123-def456 completed without broker-visible output."))
      .toBe("It finished with no reply the runtime could see");
    expect(failureWords("Codex completed without producing a final response for session-abc123-def456."))
      .toBe("Codex finished without a final response");
    expect(failureWords("tmux session session-abc123-def456 did not show a ready Claude Code composer within 64592ms."))
      .toBe("Claude Code's composer was not ready within 65 s");
  });

  test("reads a JSON-RPC error as its cause", () => {
    expect(failureWords("session/prompt failed (-32603): No space left on device")).toBe("No space left on device");
    expect(failureWords("session/prompt failed (-32603): Internal error. Retry later.")).toBe("Internal error");
  });

  test("reads a reason it does not know as its first sentence, in its own case", () => {
    expect(failureWords("model at capacity")).toBe("model at capacity");
    expect(failureWords("Something broke. The log has the rest.")).toBe("Something broke");
    expect(failureWords("Build failed (see log).")).toBe("Build failed (see log)");
    expect(failureWords("  Exited with code 137.  ")).toBe("Exited with code 137");
  });
});

describe("durationWords", () => {
  test("reads a wait in seconds, minutes and hours", () => {
    expect(durationWords(30_000)).toBe("30 s");
    expect(durationWords(64_592)).toBe("65 s");
    expect(durationWords(240_000)).toBe("4 min");
    expect(durationWords(3_600_000)).toBe("1 h");
    expect(durationWords(4_500_000)).toBe("1 h 15 min");
  });
});
