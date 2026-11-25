/**
 * Session facts on the dispatch ledger — a cardless session is an actor and an
 * endpoint with no agent card, so the ledger names its harness, checkout and
 * host from those, for whichever end of a dispatch it is.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SQLiteControlPlaneStore } from "@openscout/runtime";
import { closeDb } from "./internal/db.ts";
import { withDispatchSessionFacts } from "./broker.ts";
import type { WebBrokerDiagnostics, WebBrokerRouteAttempt } from "../../shared/api/web.ts";

const tempRoots = new Set<string>();
const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;

afterEach(() => {
  closeDb();
  if (originalControlHome === undefined) {
    delete process.env.OPENSCOUT_CONTROL_HOME;
  } else {
    process.env.OPENSCOUT_CONTROL_HOME = originalControlHome;
  }
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
});

function seedStore(): void {
  const root = mkdtempSync(join(tmpdir(), "openscout-web-session-facts-"));
  tempRoots.add(root);
  process.env.OPENSCOUT_CONTROL_HOME = root;
  const store = new SQLiteControlPlaneStore(join(root, "control-plane.sqlite"));
  store.upsertNode({
    id: "node-mini",
    meshId: "mesh-1",
    name: "dev-host.local",
    advertiseScope: "local",
    registeredAt: Date.now(),
  });
  store.upsertActor({
    id: "session-curie",
    kind: "session",
    displayName: "research-curie-3",
    metadata: {
      cardless: true,
      harness: "grok-acp",
      project: "research",
      projectRoot: "/work/research",
      model: "grok-5",
    },
  });
  store.upsertActor({ id: "agent-1", kind: "agent", displayName: "Agent One" });
  store.upsertEndpoint({
    id: "endpoint.session-curie",
    agentId: "session-curie",
    nodeId: "node-mini",
    harness: "grok-acp",
    transport: "grok_acp",
    state: "idle",
    projectRoot: "/work/research",
  });
  store.close();
}

function attempt(id: string, actorId: string, target: string): WebBrokerRouteAttempt {
  return {
    id,
    kind: "success",
    status: "delivered",
    ts: Date.now(),
    actorName: actorId,
    target,
    route: "direct",
    detail: "",
    conversationId: null,
    messageId: null,
    deliveryId: null,
    invocationId: null,
    metadata: { actorId },
  };
}

function ledger(attempts: WebBrokerRouteAttempt[]): WebBrokerDiagnostics {
  return {
    generatedAt: Date.now(),
    windowMs: 60_000,
    ledger: {
      mode: "latest",
      limit: 120,
      cursor: null,
      cursors: { attempts: null, failedQueries: null, failedDeliveries: null, dialogue: null },
      hasMore: { attempts: false, failedQueries: false, failedDeliveries: false, dialogue: false },
    },
    totals: {
      successfulDispatches: attempts.length,
      failedQueries: 0,
      failedDeliveries: 0,
      deliveryAttempts: 0,
      failedDeliveryAttempts: 0,
      dialogueMessages: 0,
    },
    rates: { messagesPerHour: 0, failedQueriesPerHour: 0, failedDeliveriesPerHour: 0, failureRate: 0 },
    attempts,
    failedQueries: [],
    failedDeliveries: [],
    dialogue: [],
  };
}

const CURIE = {
  name: "research-curie-3",
  harness: "grok-acp",
  model: "grok-5",
  project: "research",
  projectRoot: "/work/research",
  branch: null,
  node: "dev-host.local",
};

describe("withDispatchSessionFacts", () => {
  test("names where a cardless session runs, at either end", () => {
    seedStore();
    const result = withDispatchSessionFacts(ledger([
      attempt("to-curie", "operator", "session-curie"),
      attempt("from-curie", "session-curie", "@agent-1"),
    ]));
    const [toCurie, fromCurie] = result.attempts;
    expect(toCurie?.metadata?.targetSession).toEqual(CURIE);
    expect(toCurie?.metadata?.actorSession).toBeUndefined();
    expect(fromCurie?.metadata?.actorSession).toEqual(CURIE);
    expect(fromCurie?.metadata?.targetSession).toBeUndefined();
    expect(fromCurie?.metadata?.actorId).toBe("session-curie");
  });

  test("leaves agents, people and unknown ids alone", () => {
    seedStore();
    const before = ledger([attempt("plain", "operator", "agent-1"), attempt("gone", "operator", "session-gone")]);
    expect(withDispatchSessionFacts(before)).toBe(before);
  });
});
