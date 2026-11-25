import { expect, mock, test } from "bun:test";

// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const ReactJsxRuntime = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const ReactJsxDevRuntime = await import("../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const ReactDomServer = await import("../../../node_modules/react-dom/server.node.js");
mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);

import type { SessionSteerAvailability } from "../../../shared/api/session-steer.ts";
const { SessionEmbedPlace, SessionEmbedPlaceView, sessionEmbedPlaceModel, sessionEmbedSteerFor } = await import("./SessionEmbedPlace.tsx");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

const at = { sessionRef: "session:claude:s1", machine: "node:here" };
const terminalWindow: SessionSteerAvailability = {
  available: false, code: "session_blocked", reason: "",
  target: { pid: 1, processStart: "x", host: "terminal", address: "ttys005", tty: "ttys005", terminal: { app: "Terminal", window: null } },
  focus: { available: true, code: "ok", reason: "" },
} as SessionSteerAvailability;
const job: SessionSteerAvailability = {
  available: false, code: "no_window", reason: "",
  target: { pid: 1, processStart: "x", host: "terminal", address: "ttys005", tty: "ttys005", job: { id: "6d2d72b9", name: "disk-cleanup" } },
  focus: { available: false, code: "background_job", reason: "" },
} as SessionSteerAvailability;
const detached = (machine: string | null) => ({ ...at, machine, steer: {
  available: false, code: "background_copy", reason: "",
  target: { pid: 1, processStart: "x", host: "tmux", address: "%7", tty: null, terminal: { attached: false } },
  focus: { available: false, code: "tmux_detached", reason: "", attach: "tmux -S '/s' attach -t 'live'" },
} as SessionSteerAvailability });

test("a session in a Terminal window: go to that window, the page beside it", () => {
  const m = sessionEmbedPlaceModel({ ...at, steer: terminalWindow });
  expect(m.lives).toBe("Terminal · ttys005");
  expect(m.primary).toMatchObject({ to: "terminal", label: "Go to Terminal · ttys005" });
  expect(m.page?.label).toBe("Open the session page");
  const html = renderToStaticMarkup(createElement(SessionEmbedPlaceView, { model: m, go: () => {}, openPage: () => {}, line: null }));
  expect(html).toContain("Go to Terminal · ttys005");
  expect(html).toContain("Open the session page");
  expect(html).not.toContain("Scout window");
});

test("a background job opens a terminal on claude attach; a ChatGPT-held thread opens the app", () => {
  expect(sessionEmbedPlaceModel({ ...at, steer: job }).primary).toMatchObject({ to: "open-terminal", label: "Open in a terminal" });
  const codex = sessionEmbedPlaceModel({ sessionRef: "session:codex:t1", machine: "node:here", steer: { available: false, code: "native_app_refused", reason: "", target: null } });
  expect(codex.primary).toMatchObject({ to: "codex", label: "Go to the ChatGPT app" });
});

test("a detached tmux: open a terminal on it when the machine is known, else copy its attach command and offer the page", () => {
  expect(sessionEmbedPlaceModel(detached("node:here")).primary?.to).toBe("open-terminal");
  const unknown = sessionEmbedPlaceModel(detached(null));
  expect(unknown.primary?.to).toBe("page");
  expect(unknown.attach).toBe("tmux -S '/s' attach -t 'live'");
});

test("no live place: the page is the way on; nothing shows before the read", () => {
  const ended = sessionEmbedPlaceModel({ ...at, steer: { available: false, code: "not_live", reason: "", target: null } });
  expect(ended.primary?.to).toBe("page");
  expect(ended.lives).toBe("");
  expect(sessionEmbedPlaceModel({ ...at, steer: null }).primary?.to).toBe("page");
});

test("a herdr pane with no GUI terminal app the server could verify still goes to the pane", () => {
  const steer = {
    available: true, code: "ready", reason: "",
    target: { pid: 1, processStart: "x", host: "herdr", address: "scout/w1:p1", tty: null, terminal: { app: null, bundleId: null, appPid: null } },
    focus: { available: false, code: "terminal_unavailable", reason: "No unique running GUI terminal app was verified." },
  } as SessionSteerAvailability;
  expect(sessionEmbedPlaceModel({ ...at, steer }).primary).toMatchObject({ to: "terminal", label: "Go to herdr scout / w1:p1" });
});


test("a session or host change resets the reader and cannot reuse a previous capability", () => {
  const snapshot = { sessionRef: at.sessionRef, machine: at.machine, steer: terminalWindow };
  expect(sessionEmbedSteerFor(snapshot, at.sessionRef, at.machine)).toBe(terminalWindow);
  expect(sessionEmbedSteerFor(snapshot, "session:claude:s2", at.machine)).toBeNull();
  expect(sessionEmbedSteerFor(snapshot, at.sessionRef, "node:elsewhere")).toBeNull();
  const first = SessionEmbedPlace({ sessionRef: at.sessionRef, machineId: at.machine });
  expect(SessionEmbedPlace({ sessionRef: "session:claude:s2", machineId: at.machine }).key).not.toBe(first.key);
  expect(SessionEmbedPlace({ sessionRef: at.sessionRef, machineId: "node:elsewhere" }).key).not.toBe(first.key);
  expect(SessionEmbedPlace({ sessionRef: at.sessionRef, machineId: null }).key).not.toBe(first.key);
});
