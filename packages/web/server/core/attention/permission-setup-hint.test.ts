import { expect, test } from "bun:test";
import { permissionSetupHint } from "./operator-attention-state.ts";

const allowLine = (detail: string) => permissionSetupHint(detail)?.actions?.[0]?.value;

test("a blocked 0.5 reply suggests allowing the reply tool", () => {
  expect(allowLine("Permission required to use mcp__scout__reply")).toBe("/allow mcp__scout__reply");
  expect(permissionSetupHint("Permission required to use mcp__scout__reply")?.id).toBe("config:mcp-scout-reply");
});

test("a session on an older core keeps its messages_reply suggestion", () => {
  expect(allowLine("Permission required to use mcp__scout__messages_reply")).toBe("/allow mcp__scout__messages_reply");
  expect(permissionSetupHint("Permission required to use mcp__scout__messages_reply")?.id).toBe("config:mcp-scout-messages-reply");
});

test("a blocked ask suggests allowing ask", () => {
  expect(allowLine("Permission required to use mcp__scout__ask")).toBe("/allow mcp__scout__ask");
});
