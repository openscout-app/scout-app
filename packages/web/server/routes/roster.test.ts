import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { ScoutBrokerHttpError } from "@openscout/runtime/broker-api";
import type { AgentRosterImportRequest, AgentRosterListResult, RosterProjectCodeSetRequest } from "@openscout/protocol";

import { mountRosterRoutes, type RosterBroker } from "./roster.ts";

const listed: AgentRosterListResult = {
  agents: [{
    agentId: "claude.openscout.node-a", number: 3, numberText: "003", projectKey: "openscout", project: "openscout",
    projectCode: "OS", code: "OS-003", label: "OS 003", source: "auto", assignedAt: 1,
  }],
  projects: [{ projectKey: "openscout", name: "openscout", code: "OS", codeSource: "default", defaultCode: "OS", createdAt: 1, updatedAt: 1 }],
  capacity: { max: 999, held: 1 },
};

function fakeBroker(overrides: Partial<RosterBroker> = {}) {
  const calls: { codes: RosterProjectCodeSetRequest[]; imports: AgentRosterImportRequest[] } = { codes: [], imports: [] };
  const broker: RosterBroker = {
    list: async () => listed,
    setProjectCode: async (body) => {
      calls.codes.push(body);
      return { project: { ...listed.projects[0]!, code: body.code, codeSource: "operator" } };
    },
    importEntries: async (body) => {
      calls.imports.push(body);
      return { dryRun: body.dryRun === true, imported: [], renumbered: [], projectCodes: [], conflicts: [] };
    },
    ...overrides,
  };
  return { broker, calls };
}

function app(peer: string, broker: RosterBroker) {
  const server = new Hono();
  mountRosterRoutes(server, { options: { resolvePeerAddress: () => peer }, broker });
  return server;
}

const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("roster routes", () => {
  test("a page on the host reads the runtime's roster", async () => {
    const response = await app("127.0.0.1", fakeBroker().broker).request("http://127.0.0.1:43120/api/roster");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(listed);
  });

  test("a page on another device can neither read nor change the roster", async () => {
    const { broker, calls } = fakeBroker();
    const server = app("192.168.1.40", broker);
    const read = await server.request("http://m1.scout.local/api/roster");
    expect(read.status).toBe(403);
    expect((await read.json()).code).toBe("local_only");
    const set = await server.request("http://m1.scout.local/api/roster/projects/code", post({ project: "openscout", code: "OP" }));
    const imported = await server.request("http://m1.scout.local/api/roster/import", post({ entries: [], dryRun: false }));
    expect([set.status, imported.status]).toEqual([403, 403]);
    expect(calls).toEqual({ codes: [], imports: [] });
  });

  test("a project code goes to the runtime in capitals, and an empty one resets it", async () => {
    const { broker, calls } = fakeBroker();
    const server = app("127.0.0.1", broker);
    expect((await server.request("http://127.0.0.1:43120/api/roster/projects/code", post({ project: "openscout", code: "op" }))).status).toBe(200);
    expect((await server.request("http://127.0.0.1:43120/api/roster/projects/code", post({ project: "openscout", code: null }))).status).toBe(200);
    expect(calls.codes).toEqual([{ project: "openscout", code: "OP" }, { project: "openscout", code: null }]);
  });

  test("the runtime's refusal comes back with its sentence and the project that holds the code", async () => {
    const held = JSON.stringify({ error: "project_code_held", detail: "OS is held by project \"openscout\"", code: "OS", heldBy: "openscout" });
    const { broker } = fakeBroker({ setProjectCode: async () => { throw new ScoutBrokerHttpError(409, "/v1/roster/projects/code", held, "project_code_held"); } });
    const response = await app("127.0.0.1", broker).request("http://127.0.0.1:43120/api/roster/projects/code", post({ project: "openscout-labs", code: "OS" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "OS is held by project \"openscout\"", code: "project_code_held", heldBy: "openscout" });
  });

  test("a runtime that does not answer is not a refusal", async () => {
    const { broker } = fakeBroker({ list: async () => { throw new Error("connect ECONNREFUSED"); } });
    const response = await app("127.0.0.1", broker).request("http://127.0.0.1:43120/api/roster");
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe("runtime_unavailable");
  });

  test("an import is a dry run unless it says dryRun false", async () => {
    const { broker, calls } = fakeBroker();
    const server = app("127.0.0.1", broker);
    const entries = [{ agentId: "claude.openscout.node-a", number: "006", projectCode: "OS" }];
    await server.request("http://127.0.0.1:43120/api/roster/import", post({ entries }));
    await server.request("http://127.0.0.1:43120/api/roster/import", post({ entries, dryRun: true }));
    await server.request("http://127.0.0.1:43120/api/roster/import", post({ entries, dryRun: false }));
    expect(calls.imports.map((call) => call.dryRun)).toEqual([true, true, false]);
    expect(calls.imports[2]!.entries).toEqual(entries);
  });

  test("an import without an entries list is refused before the runtime", async () => {
    const { broker, calls } = fakeBroker();
    const response = await app("127.0.0.1", broker).request("http://127.0.0.1:43120/api/roster/import", post({ dryRun: false }));
    expect(response.status).toBe(400);
    expect(calls.imports).toEqual([]);
  });
});
