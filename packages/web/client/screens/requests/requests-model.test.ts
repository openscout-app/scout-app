import { describe, expect, test } from "bun:test";
import type { OperatorAttentionItem } from "../../lib/types.ts";
import { isDeclaredRequest, isRequestDismissal, panePromptNote, requestActions, requestActionLabel, requestKind, requestKindTag, requestsCountState, requestUpdatedAge, stableRequestItems } from "./requests-model.ts";
const item = (id: string, overrides: Partial<OperatorAttentionItem> = {}): OperatorAttentionItem => ({
  id, kind: "question", title: "Question", summary: null, detail: null, agentId: null, agentName: null,
  conversationId: null, updatedAt: 60_000, severity: "info", sourceLabel: "question", actions: [], ...overrides,
});

describe("Requests projection", () => {
  test("zero and invalid counts are neutral; only positive counts request orange", () => {
    expect(requestsCountState(0)).toEqual({ count: 0, attention: false });
    expect(requestsCountState(-1)).toEqual({ count: 0, attention: false });
    expect(requestsCountState(NaN)).toEqual({ count: 0, attention: false });
    expect(requestsCountState(3)).toEqual({ count: 3, attention: true });
  });
  test("live rows hold their place despite incoming severity sorting", () => {
    const a = item("a"); const b = item("b"); const litA = item("a", { severity: "critical" });
    expect(stableRequestItems([a, b], [b, litA, item("c")]).map(row => row.id)).toEqual(["a", "b", "c"]);
    expect(stableRequestItems([a, b], [b, litA])[0]).toBe(litA);
    expect(stableRequestItems([a, b], [b]).map(row => row.id)).toEqual(["b"]);
  });
  test("only real source links and backed pairing decisions are offered", () => {
    const actions = [{ kind: "approve", label: "Approve" }, { kind: "deny", label: "Deny" },
      { kind: "copy", label: "Copy", value: "command" }, { kind: "dismiss", label: "Dismiss" },
      { kind: "open", label: "Open", route: { view: "conversation", conversationId: "c" } },
      { kind: "open", label: "Broken link" }] as OperatorAttentionItem["actions"];
    expect(requestActions(item("q", { actions })).map(action => action.kind)).toEqual(["open"]);
    expect(requestActionLabel(actions[4]!)).toBe("Open conversation");
    const approval = { sessionId: "s", sessionName: "session", adapterType: "codex", turnId: "t", blockId: "b", version: 1,
      risk: "low", title: "Run?", description: "command", detail: null, actionKind: "command", actionStatus: "pending" } as const;
    expect(requestActions(item("p", { kind: "approval", approval, actions })).map(action => action.kind)).toEqual(["approve", "deny", "open"]);
  });
  test("source terminology and timestamps do not fabricate waiting duration", () => {
    expect(requestKind(item("a", { kind: "approval" }))).toBe("Approval");
    expect(requestKind(item("p", { sourceLabel: "permission" }))).toBe("Permission request");
    expect(requestKind(item("q"))).toBe("Ask");
    expect(requestKind(item("failure", { kind: "ask" }))).toBe("Notice");
    expect(requestKindTag(item("p", { sourceLabel: "permission" }))).toBe("Permission");
    expect(requestKindTag(item("a", { kind: "approval" }))).toBe("Approval");
    expect(requestUpdatedAge(60_000, 240_000)).toBe("updated 3m ago");
    expect(requestUpdatedAge(0, 240_000)).toBe("Update time unavailable");
    expect(requestUpdatedAge(0 + 1, 1 + 5 * 3_600_000)).toBe("updated 5h ago");
    expect(requestUpdatedAge(1, 1 + 4 * 86_400_000)).toBe("updated 4d ago");
  });
});

test("only declared kinds are requests", () => {
  const kinds = ["approval", "question", "configuration", "work_item", "ask", "session"] as const;
  const declared = kinds.filter((kind) => isDeclaredRequest({ id: `x:${kind}`, kind } as never));
  expect(declared).toEqual(["approval", "question", "configuration"]);
});

test("declared permission decisions retain the exact native scopes", () => {
  const permission = item("permission:p", { sourceLabel: "Permission request",
    permission: { requestId: "p", version: "v", sessionId: "s", projectRoot: "/p" },
    actions: [{ kind: "approve", label: "Allow once", value: "once" }, { kind: "approve", label: "Allow for project", value: "project" }, { kind: "deny", label: "Deny", value: "deny" }],
  });
  expect(isDeclaredRequest(permission)).toBe(true); expect(requestKind(permission)).toBe("Permission request");
  expect(requestActions(permission).map(action => action.value)).toEqual(["once", "project", "deny"]);
});

test("the runtime's dismissal is offered on permission requests and agents' questions, and nowhere else", () => {
  const dismiss = (recordId: string) => ({ kind: "dismiss", label: "Dismiss", recordKind: "question", recordId }) as OperatorAttentionItem["actions"][number];
  const permission = item("permission:p", { permission: { requestId: "p", version: "v", sessionId: "s", projectRoot: "/p" },
    actions: [{ kind: "deny", label: "Deny", value: "deny" }, dismiss("p")] });
  const question = item("need:msg-1", { actions: [dismiss("operator-question:msg-1")] });
  // A question record from the work list keeps its own dismissal, which Requests does not offer.
  const workQuestion = item("question:q-1", { actions: [dismiss("q-1")] });
  const flight = item("need:msg-2", { actions: [{ kind: "dismiss", label: "Dismiss", flightId: "flt" }] });
  expect(requestActions(permission).map(action => action.kind)).toEqual(["deny", "dismiss"]);
  expect(requestActions(question).map(action => action.recordId)).toEqual(["operator-question:msg-1"]);
  expect(isRequestDismissal(question, question.actions[0]!)).toBe(true);
  expect(requestActions(workQuestion)).toEqual([]);
  expect(requestActions(flight)).toEqual([]);
});

describe("prompts on a tmux pane", () => {
  const yesNo = [{ kind: "approve", label: "Yes", value: "yes" }, { kind: "deny", label: "No", value: "no" },
    { kind: "open", label: "Open terminal", route: { view: "terminal", agentId: "hopper", mode: "takeover" } }] as OperatorAttentionItem["actions"];
  const pane = (prompt?: NonNullable<OperatorAttentionItem["pane"]>["prompt"]) => ({ backend: "tmux" as const, sessionName: "relay-hopper-claude", ...(prompt ? { prompt } : {}) });
  const onPane = (prompt?: NonNullable<OperatorAttentionItem["pane"]>["prompt"]) =>
    item("tmux-host-permission:hopper:relay-hopper-claude", { kind: "session", sourceLabel: "Claude terminal prompt", pane: pane(prompt), actions: yesNo });

  test("a plain permission dialog keeps Yes and No; anything more keeps only the way to the terminal", () => {
    expect(requestActions(onPane({ kind: "permission", version: 7, choices: 3, answerable: true })).map((a) => a.label)).toEqual(["Yes", "No", "Open terminal"]);
    expect(requestActions(onPane({ kind: "plan", version: 7, choices: 3, answerable: false })).map((a) => a.label)).toEqual(["Open terminal"]);
    expect(requestActions(onPane()).map((a) => a.label)).toEqual(["Open terminal"]);
  });

  test("more than Yes or No says what is waiting and how many choices it offers", () => {
    expect(panePromptNote(pane({ kind: "permission", version: 7, choices: 3, answerable: true }))).toBeNull();
    expect(panePromptNote(pane({ kind: "plan", version: 7, choices: 3, answerable: false }))).toBe("A plan approval, with 3 choices. Jump in to choose in the pane.");
    expect(panePromptNote(pane({ kind: "plan", version: 7, choices: 0, answerable: false }))).toBe("A plan approval. Jump in to choose in the pane.");
    expect(panePromptNote(pane({ kind: "hold", version: 7, choices: 1, answerable: false }))).toBe("An action auto mode held, with 1 choice. Jump in to choose in the pane.");
    expect(panePromptNote(pane({ kind: "unknown", version: 7, choices: 0, answerable: false }))).toBe("Jump in to answer it in the pane.");
    expect(panePromptNote(pane())).toBe("Jump in to answer it in the pane.");
  });

  test("the kind names the dialog: a plan is an approval, an unread menu an ask", () => {
    expect(requestKind(onPane({ kind: "permission", version: 7, choices: 3, answerable: true }))).toBe("Permission request");
    expect(requestKind(onPane({ kind: "hold", version: 7, choices: 2, answerable: false }))).toBe("Permission request");
    expect(requestKind(onPane({ kind: "plan", version: 7, choices: 3, answerable: false }))).toBe("Approval");
    expect(requestKind(onPane({ kind: "unknown", version: 7, choices: 0, answerable: false }))).toBe("Ask");
    expect(isDeclaredRequest(onPane({ kind: "plan", version: 7, choices: 3, answerable: false }))).toBe(true);
  });
});
