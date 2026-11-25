import { expect, test } from "bun:test";
import type { Agent, OperatorAttentionItem, SessionEntry, TailDiscoveredTranscript } from "../../lib/types.ts";
import { attentionForSession, boardRowActivityLabel, boardRowFallbackRef, boardRowQueued, boardRowMeta, boardRowProject, boardRowTask, boardRowWho, buildSessionBoardRows, createSessionRowsMemo, foldSubagentRows, harnessSessionTitle, matchesSessionFilter, rowMatchesSelection, sessionOrigin, sessionPageTitle, sessionProjectGroups } from "./session-board-model.ts";
import { MAC_HOME_ROOT } from "../../../test-support/path-fixtures.ts";
const conversation = (patch: Partial<SessionEntry> = {}): SessionEntry => ({ id: "c1", kind: "direct", title: "Build Sessions", participantIds: ["requester", "worker"],
  participants: [{ actorId: "requester", kind: "agent", agentId: "requester", displayName: "Release agent", label: "Release agent" }],
  agentId: "worker", agentName: "Worker", harness: "codex", sessionId: "sess.1", harnessSessionId: "provider-1", harnessLogPath: null,
  currentBranch: "main", preview: null, messageCount: 1, lastMessageAt: 1, workspaceRoot: "/repo", ...patch });
const input = () => ({ conversations: [conversation()], transcripts: [], agents: [] as Agent[], events: [], attention: [], now: 100 });
test("an idle parent names its children's work, and queued work never claims an active turn", () => {
  const [parent] = buildSessionBoardRows(input());
  const child = { ...parent!, working: true };
  expect(boardRowActivityLabel(parent!, [child])).toBe("Subagent working");
  expect(boardRowActivityLabel(parent!, [child, child])).toBe("Subagents working");
  expect(boardRowActivityLabel(parent!, [{ ...child, asks: true }])).toBe("Subagent waiting");
  expect(boardRowActivityLabel({ ...parent!, working: true }, [{ ...child, asks: true }])).toBe("Subagent waiting");
  expect(boardRowActivityLabel({ ...parent!, working: true }, [child])).toBe("Working");
  const queued = { ...child, lane: { id: "queued", source: "scout" as const, agent: { id: "a", state: "queued" } as Agent, observe: null, lastActiveAt: 1, current: true } };
  expect(boardRowQueued(queued)).toBe(true);
  expect(boardRowActivityLabel(queued)).toBe("Queued");
  expect(boardRowActivityLabel(parent!, [queued])).toBe("Subagent queued");
  expect(boardRowActivityLabel({ ...queued, asks: true })).toBe("Waiting");
});
test("agent-started single-session conversations are included without operator participation", () => {
  const rows = buildSessionBoardRows(input()); expect(rows).toHaveLength(1);
  expect(rows[0].origin).toEqual({ kind: "agent", label: "started by Release agent" });
  expect(rows[0].selection.sessionRef).toBe("session:codex:sess.1");
  expect(matchesSessionFilter(rows[0], { scope: "from_agents" })).toBe(true);
});
test("two conversations for one Scout ref join its native transcript once and show the newer conversation", () => {
  const older = conversation({ id: "c1", sessionId: "scout-session", harnessSessionId: "native", lastMessageAt: 1 });
  const newer = conversation({ id: "c2", sessionId: "scout-session", harnessSessionId: null, lastMessageAt: 5 });
  const transcript = { source: "codex", sessionId: "native", transcriptPath: "/tmp/native.jsonl", cwd: "/repo", project: "repo",
    harness: "unattributed", mtimeMs: 3, size: 1 } as TailDiscoveredTranscript;
  const rows = buildSessionBoardRows({ ...input(), conversations: [newer, older], transcripts: [transcript] });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ selection: { sessionRef: "session:codex:scout-session" }, lastActiveAt: 5, conversation: { id: "c2" }, lane: { id: "native" } });
});

test("unbacked rooms are not session rows", () => {
  expect(buildSessionBoardRows({ ...input(), conversations: [conversation({ kind: "channel", sessionId: null })] })).toEqual([]);
});
test("observed sessions without any conversation remain sessions", () => {
  const transcript = { source: "codex", sessionId: "native-1", transcriptPath: "/tmp/native-1.jsonl", cwd: "/repo", project: "repo", harness: "unattributed", mtimeMs: 1, size: 1 } as TailDiscoveredTranscript;
  const rows = buildSessionBoardRows({ ...input(), conversations: [], transcripts: [transcript] });
  expect(rows).toHaveLength(1); expect(rows[0].working).toBe(false);
  expect(rows[0].selection.sessionRef).toBe("session:codex:native-1");
  expect(rows[0].origin.kind).toBe("unknown");
});
test("filtering respects the slot scope", () => {
  const rows = buildSessionBoardRows(input());
  expect(matchesSessionFilter(rows[0], { scope: "all", project: "/other" })).toBe(false);
  expect(matchesSessionFilter(rows[0], { scope: "all", machine: "local" })).toBe(true);
  expect(matchesSessionFilter(rows[0], { scope: "working" })).toBe(false);
  expect(matchesSessionFilter({ ...rows[0], asks: true }, { scope: "working_asks" })).toBe(true);
});
test("approval matching uses exact session, never the agent's other active session", () => {
  const item = { id: "approval", agentId: "worker", conversationId: "c1", approval: { sessionId: "old" } } as OperatorAttentionItem;
  expect(attentionForSession([item], ["current"], "c1")).toEqual([]);
  expect(attentionForSession([item], ["old"])).toEqual([item]);
});
test("initiating ask is stronger evidence than membership; unknown origins stay unknown", () => {
  expect(sessionOrigin({ requester: { requesterId: "operator", requesterName: "Art" }, conversation: conversation() }).label).toBe("started by you");
  expect(sessionOrigin({ requester: { requesterId: "agent-2", requesterName: "Agent 2" } }).label).toBe("started by Agent 2");
  expect(sessionOrigin({ conversation: conversation({ kind: "channel" }) }).kind).toBe("unknown");
});
test("native questions use exact follow routes, not agent identity", () => {
  const item = { id: "question", kind: "question", conversationId: null, actions: [{ kind: "open", route: { view: "follow", sessionId: "session:codex:native" } }] } as OperatorAttentionItem;
  expect(attentionForSession([item], ["native"])).toEqual([item]);
  expect(attentionForSession([item], ["other"])).toEqual([]);
  expect(attentionForSession([item], ["session:claude:native"])).toEqual([]);
});
test("remote approvals remain scoped to their originating machine and payload", () => {
  const remote = { id: "remote-approval", approval: { sessionId: "remote:peer%3A2:native" } } as OperatorAttentionItem;
  const local = { id: "local-approval", approval: { sessionId: "native" } } as OperatorAttentionItem;
  expect(attentionForSession([remote, local], ["native"], null, "peer:2", "here")).toEqual([remote]);
  expect(attentionForSession([remote, local], ["native"], null, "here", "here")).toEqual([local]);
  expect(attentionForSession([remote], ["native"])).toEqual([]);
  expect(attentionForSession([remote], ["native"], null, "elsewhere")).toEqual([]);
});
test("Observe runtime and provider aliases both receive the exact inline request", () => {
  const approval = { id: "pairing-approval", approval: { sessionId: "pairing-session-1" } } as OperatorAttentionItem;
  const native = { id: "native-question", actions: [{ kind: "open", route: { view: "follow", sessionId: "provider-session" } }] } as OperatorAttentionItem;
  expect(attentionForSession([approval, native], ["provider-session", "pairing-session-1"], null, "here", "here")).toEqual([approval, native]);
});

test("a selection names its row by id and harness, and by machine when it names one", () => {
  const [row] = buildSessionBoardRows({ ...input(), localNodeId: "here" });
  expect(rowMatchesSelection(row, { sessionRef: "session:codex:provider-1" })).toBe(true);
  expect(rowMatchesSelection(row, { sessionRef: "session:codex:provider-1", machineId: "here" })).toBe(true);
  expect(rowMatchesSelection(row, { sessionRef: "session:codex:provider-1", machineId: "mini" })).toBe(false);
  expect(rowMatchesSelection(row, { sessionRef: "session:claude:provider-1" })).toBe(false);
  expect(rowMatchesSelection(row, null)).toBe(false);
});
test("readers share one build and reorder when the displayed activity changes", () => {
  const memo = createSessionRowsMemo();
  const base = input();
  const first = memo(base);
  expect(memo({ ...base })).toBe(first);
  const second = conversation({ id: "c2", title: "Second", sessionId: "sess.2", harnessSessionId: "provider-2", lastMessageAt: 2 });
  const grown = memo({ ...base, conversations: [second, ...base.conversations] });
  expect(grown.map((r) => r.title)).toEqual(["Second", "Build Sessions"]);
  const updated = memo({ ...base, conversations: [second, conversation({ lastMessageAt: 3 })] });
  expect(updated.map((r) => r.title)).toEqual(["Build Sessions", "Second"]);
});
test("a project shows running sessions, then the newest idle ones; projects sort by their newest row", () => {
  const [row] = buildSessionBoardRows(input());
  const rows = [
    { ...row, key: "old", project: "/alpha", lastActiveAt: 10 },
    { ...row, key: "busy", project: "/alpha", working: true, lastActiveAt: 1 },
    { ...row, key: "unknown", project: "/alpha", lastActiveAt: null },
    { ...row, key: "new", project: "/alpha", lastActiveAt: 20 },
    { ...row, key: "other", project: "/beta", lastActiveAt: 25 },
  ];
  const sorted = foldSubagentRows(rows).rows;
  expect(sessionProjectGroups(sorted).map((g) => [g.label, g.sessions.map((r) => r.key)]))
    .toEqual([["beta", ["other"]], ["alpha", ["busy", "new", "old", "unknown"]]]);
});

test("a row reads as its task: a title that is only the agent's name gives way to the task, then what it said", () => {
  const [titled] = buildSessionBoardRows({ ...input(), conversations: [conversation({ title: "**Fix** the `board` rows" })] });
  expect(boardRowTask(titled)).toBe("Fix the board rows");
  expect(boardRowMeta(titled)).toBe("Worker");
  // under its project's line, an agent named for the project is already said
  expect(boardRowMeta(titled, "worker")).toBe("");
  expect(boardRowMeta(titled, "other-app")).toBe("Worker");
  const [named] = buildSessionBoardRows({ ...input(), conversations: [conversation({ title: "Worker", preview: "[ask:a1] Port the Chats list" })] });
  expect(boardRowTask(named)).toBe("Port the Chats list");
  const [bare] = buildSessionBoardRows({ ...input(), conversations: [conversation({ title: "Worker", preview: null, participants: [], participantIds: ["worker"] })] });
  expect(boardRowTask(bare)).toBe("Worker");
  // the name is the line already, and an unknown start says nothing
  expect(boardRowMeta(bare)).toBe("");
});
test("your own starts go unsaid; a parent session is named, never by its id", () => {
  expect(boardRowMeta({ title: "Task", preview: null, conversation: null, lane: null, origin: { kind: "you", label: "started by you" } })).toBe("");
  expect(sessionOrigin({ parentSessionId: "587247a3-a953-49af-aabc-e01517f5fc97" }).label).toBe("started by another session");
});
test("a session Scout started is one row: its transcript joins its conversation by launch name", () => {
  // as the runtime lists one: titled by its agent, keyed by Scout's session id, last reply as preview
  const started = conversation({ agentId: "session-1", agentName: "Scout", title: "Scout", harness: "claude", sessionId: "session-1", harnessSessionId: null,
    participants: [], participantIds: ["operator", "session-1"], preview: "Done. PR: https://github.com/o/r/pull/1", task: "Fix the **pairing** handshake" });
  const transcript = (sessionId: string, at: number) => ({ source: "claude", sessionId, title: "session-1-relay-agent", transcriptPath: `/t/${sessionId}.jsonl`,
    cwd: "/repo", project: "repo", harness: "unattributed", lastEventAt: at, mtimeMs: at, size: 1 }) as TailDiscoveredTranscript;
  const rows = buildSessionBoardRows({ ...input(), conversations: [started], transcripts: [transcript("harness-1", 5)] });
  expect(rows).toHaveLength(1);
  const [row] = rows;
  expect(row.selection.sessionRef).toBe("session:claude:session-1");
  expect(row.lane?.id).toBe("harness-1");
  expect(rowMatchesSelection(row, { sessionRef: "session:claude:session-1" })).toBe(true);
  expect(rowMatchesSelection(row, { sessionRef: "session:claude:harness-1" })).toBe(true);
  // what it was asked, not what it last said
  expect(boardRowTask(row)).toBe("Fix the pairing handshake");
  expect(boardRowMeta(row)).toBe("Scout");
  const [untasked] = buildSessionBoardRows({ ...input(), conversations: [{ ...started, task: undefined }], transcripts: [transcript("harness-1", 5)] });
  expect(boardRowTask(untasked)).toBe("Done. PR: https://github.com/o/r/pull/1");
  // a relaunch leaves an older transcript under the same name: the newest joins, the older keeps its own row
  const relaunched = buildSessionBoardRows({ ...input(), conversations: [started], transcripts: [transcript("harness-0", 1), transcript("harness-1", 5)] });
  expect(relaunched.map((r) => r.lane?.id)).toEqual(["harness-1", "harness-0"]);
  // an agent with two session rows names neither
  const twice = buildSessionBoardRows({ ...input(), conversations: [started, { ...started, id: "c2", sessionId: "session-2" }], transcripts: [transcript("harness-1", 5)] });
  expect(twice).toHaveLength(3);
  // runtimes that report each title kind: the agent name joins, and the harness's own title leads
  const parts = { ...transcript("harness-1", 5), customTitle: "session-1-relay-agent", agentName: "session-1-relay-agent", aiTitle: "Fix the release checklist" };
  const [titled] = buildSessionBoardRows({ ...input(), conversations: [started], transcripts: [parts] });
  expect(titled.selection.sessionRef).toBe("session:claude:session-1");
  expect(boardRowTask(titled)).toBe("Fix the release checklist");
  const renamed = { ...parts, title: "Release prep", customTitle: "Release prep", aiTitle: null };
  const rows2 = buildSessionBoardRows({ ...input(), conversations: [started], transcripts: [renamed] });
  expect(rows2).toHaveLength(1);
  expect(boardRowTask(rows2[0])).toBe("Release prep");
});
test("every listed row can be read: a joined row falls back to the transcript it was listed from", () => {
  const started = conversation({ agentId: "session-1", agentName: "Scout", title: "Scout", harness: "claude", sessionId: "session-1", harnessSessionId: null,
    participants: [], participantIds: ["operator", "session-1"] });
  const transcript = (sessionId: string, title?: string) => ({ source: "claude", sessionId, title, transcriptPath: `/t/${sessionId}.jsonl`,
    cwd: "/repo", project: "repo", harness: "unattributed", lastEventAt: 5, mtimeMs: 5, size: 1 }) as TailDiscoveredTranscript;
  const rows = buildSessionBoardRows({ ...input(), conversations: [conversation(), started],
    transcripts: [transcript("harness-1", "session-1-relay-agent"), transcript("native-2")] });
  expect(rows).toHaveLength(3);
  const transcriptIds = new Set(["harness-1", "native-2"]);
  for (const row of rows) {
    const fallback = boardRowFallbackRef(row, [row.selection.sessionRef]);
    const refs = [row.selection.sessionRef, fallback].filter(Boolean).map((ref) => ref!.split(":").at(-1));
    // a row backed by a transcript is always readable through that transcript's id
    if (row.lane && transcriptIds.has(row.lane.id)) expect(refs).toContain(row.lane.id);
  }
  const joined = rows.find((row) => row.lane?.id === "harness-1")!;
  // a Scout id the runtime no longer knows still opens through the harness's own id
  expect(joined.selection.sessionRef).toBe("session:claude:session-1");
  expect(boardRowFallbackRef(joined, [joined.selection.sessionRef])).toBe("session:claude:harness-1");
  // a row read by its own id needs no fallback, and nothing is tried twice
  expect(boardRowFallbackRef(rows.find((row) => row.lane?.id === "native-2"), ["session:claude:native-2"])).toBeNull();
  expect(boardRowFallbackRef(joined, ["session:claude:session-1", "session:claude:harness-1"])).toBeNull();
  expect(boardRowFallbackRef(null, [])).toBeNull();
});
test("a harness session's own name titles its row; Scout's launch name never does", () => {
  const transcript = { source: "claude", sessionId: "named-1", title: "Board view brief", transcriptPath: "/t/named-1.jsonl", cwd: "/repo", project: "repo",
    harness: "unattributed", mtimeMs: 1, size: 1 } as TailDiscoveredTranscript;
  const [row] = buildSessionBoardRows({ ...input(), conversations: [], transcripts: [transcript] });
  expect(boardRowTask(row)).toBe("Board view brief");
  expect(harnessSessionTitle({ title: "session-1-relay-agent" })).toBeNull();
  expect(harnessSessionTitle({ title: "  " })).toBeNull();
});
test("rows are listed under their folder's name, home, or No project", () => {
  expect(boardRowProject({ project: `${MAC_HOME_ROOT}/workstation-user/dev/openscout/demo-app/` })).toBe("demo-app");
  expect(boardRowProject({ project: `${MAC_HOME_ROOT}/workstation-user` })).toBe("home");
  expect(boardRowProject({ project: null })).toBe("No project");
});
const claude = (sessionId: string, patch: Partial<TailDiscoveredTranscript> = {}) => ({ source: "claude", sessionId, transcriptPath: `/t/${sessionId}.jsonl`,
  cwd: "/repo", project: "repo", harness: "unattributed", lastEventAt: 1, mtimeMs: 1, size: 1, ...patch }) as TailDiscoveredTranscript;
test("a subagent listed with its parent folds into the parent's row; one without a listed parent keeps its own", () => {
  const rows = buildSessionBoardRows({ ...input(), conversations: [], transcripts: [
    claude("d97dbae8-0000-4000-8000-000000000001", { aiTitle: "Board view brief" }),
    claude("ac12655c11", { parentSessionId: "d97dbae8-0000-4000-8000-000000000001", subagentId: "ac12655c11" }),
    // a subagent's subagent folds into the outermost listed parent
    claude("aaa2c12011", { parentSessionId: "ac12655c11", subagentId: "aaa2c12011" }),
    claude("a0e580a011", { parentSessionId: "gone-parent", subagentId: "a0e580a011" }),
  ] });
  const { rows: shown, subagents } = foldSubagentRows(rows);
  expect(shown.map((row) => row.sessionId)).toEqual(["a0e580a011", "d97dbae8-0000-4000-8000-000000000001"]);
  const [orphan, parent] = shown;
  expect(subagents.get(parent.key)?.map((row) => row.sessionId)).toEqual(["ac12655c11", "aaa2c12011"]);
  expect(subagents.has(orphan.key)).toBe(false);
  // the count sits beside the age, so it adds no line under the parent's task
  expect(boardRowMeta(parent)).toBe("");
  // who started it is in the details, not on the row
  expect(boardRowMeta(orphan)).toBe("");
  // a loop of parents has no outermost one: both keep their rows
  const [a, b] = [rows[1], rows[2]];
  const loop = [{ ...a, lane: { ...a.lane!, facts: { ...a.lane!.facts!, parentSessionId: b.sessionId } } }, b];
  expect(foldSubagentRows(loop).rows).toHaveLength(2);
});
test("a name Scout made up from the harness and an id names nobody", () => {
  const [plain, sub, nicknamed] = buildSessionBoardRows({ ...input(), conversations: [], transcripts: [
    claude("d97dbae8-0000-4000-8000-000000000001", { aiTitle: "Board view brief" }),
    claude("ac12655c11", { parentSessionId: "elsewhere", subagentId: "ac12655c11" }),
    claude("bb12655c11", { parentSessionId: "elsewhere", subagentId: "bb12655c11", agentNickname: "Pauli" }),
  ] });
  expect(plain.lane?.agent.name).toBe("Claude d97dbae8");
  expect(boardRowWho(plain)).toBeNull();
  expect(boardRowMeta(plain)).toBe("");
  expect(boardRowWho(sub)).toBeNull();
  // a name the harness gave is kept
  expect(boardRowWho(nicknamed)).toBe("Pauli");
  // and an agent's name always shows
  const [scout] = buildSessionBoardRows(input());
  expect(boardRowWho(scout)).toBe("Worker");
});

test("page headings remove a harness prefix without hiding the task", () => {
  expect(sessionPageTitle("Grok 01a1c133", "grok")).toBe("01a1c133");
  expect(sessionPageTitle("Claude subagent ac12655c", "claude")).toBe("subagent ac12655c");
  expect(sessionPageTitle("Fix the board rows", "claude")).toBe("Fix the board rows");
  expect(sessionPageTitle("Grok explore", "grok")).toBe("Grok explore");
});
test("page headings preserve operator names verbatim", () => {
  expect(sessionPageTitle("Claude deadbeef", "claude", false)).toBe("deadbeef");
  expect(sessionPageTitle("Claude deadbeef", "claude", true)).toBe("Claude deadbeef");
});
test("a session the operator named reads as that name, over its task line and the harness title", () => {
  const transcript = { source: "claude", sessionId: "native-9", title: "Session names", customTitle: "kernel-panic-last-boot", sessionName: "Session names",
    sessionNameSource: "operator", transcriptPath: "/t/native-9.jsonl", cwd: "/repo", project: "repo", harness: "unattributed", mtimeMs: 1, size: 1 } as TailDiscoveredTranscript;
  const [row] = buildSessionBoardRows({ ...input(), conversations: [], transcripts: [transcript] });
  expect(row.title).toBe("Session names");
  expect(row.named).toBe(true);
  expect(boardRowTask({ ...row, preview: "Fix the build" })).toBe("Session names");
  const [unnamed] = buildSessionBoardRows({ ...input(), conversations: [], transcripts: [{ ...transcript, sessionName: null, sessionNameSource: null, title: "kernel-panic-last-boot" }] });
  expect(unnamed.title).toBe("kernel-panic-last-boot");
  expect(unnamed.named).toBeFalsy();
});
