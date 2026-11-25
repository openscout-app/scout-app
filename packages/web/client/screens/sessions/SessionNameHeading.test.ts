import { afterEach, describe, expect, mock, test } from "bun:test";
import type { SessionNameSetBody, SessionNameSetResult } from "../../../shared/api/session-names.ts";
// @ts-expect-error Direct runtime path avoids the React type-only alias.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Direct runtime path avoids the React type-only alias.
const ReactDOM = await import("../../../node_modules/react-dom/client.js");
mock.module("react", () => React);
const {
  limitSessionName,
  sessionNameEdit,
  sessionNameKeyAction,
  useSessionNameFieldController,
  useSessionNameHeading,
} = await import("./SessionNameHeading.tsx");

const originals = new Map<string, PropertyDescriptor | undefined>();
function globalValue(key: string, value: unknown) {
  if (!originals.has(key)) originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
let root: ReturnType<typeof ReactDOM.createRoot> | undefined;
let heading: ReturnType<typeof useSessionNameHeading>;
let field: ReturnType<typeof useSessionNameFieldController>;
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function HeadingProbe(props: Parameters<typeof useSessionNameHeading>[0]) {
  heading = useSessionNameHeading(props);
  return null;
}
function FieldProbe({ value, onCommit, onCancel }: { value: string; onCommit: (draft: string) => void; onCancel: () => void }) {
  field = useSessionNameFieldController(value, onCommit, onCancel);
  return null;
}
function mount(fetcher?: typeof fetch) {
  const win = Object.assign(new EventTarget(), { HTMLIFrameElement: class {} });
  const doc = Object.assign(new EventTarget(), { nodeType: 9, defaultView: win, activeElement: null, documentElement: { namespaceURI: "http://www.w3.org/1999/xhtml" } });
  const container = Object.assign(new EventTarget(), { nodeType: 1, tagName: "DIV", nodeName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: doc, textContent: "" });
  globalValue("window", win);
  globalValue("document", doc);
  globalValue("fetch", fetcher ?? (async () => { throw new Error("unexpected fetch"); }));
  globalValue("IS_REACT_ACT_ENVIRONMENT", true);
  root = ReactDOM.createRoot(container as unknown as Element);
}
async function renderHeading(props: Parameters<typeof useSessionNameHeading>[0]) {
  await React.act(async () => { root!.render(React.createElement(HeadingProbe, props)); await flush(); });
}
async function renderField(commits: string[], cancels: () => void) {
  await React.act(async () => {
    root!.render(React.createElement(FieldProbe, { value: "Harness title", onCommit: (draft: string) => commits.push(draft), onCancel: cancels }));
    await flush();
  });
}

afterEach(async () => {
  if (root) await React.act(async () => { root!.unmount(); });
  root = undefined;
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});

type PendingSave = {
  body: SessionNameSetBody;
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
};
function deferredFetch(pending: PendingSave[]): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    pending.push({ body: JSON.parse(String(init?.body)) as SessionNameSetBody, resolve, reject });
  })) as typeof fetch;
}
function savedName(name: string | null): SessionNameSetResult {
  const operator = name !== null;
  return {
    ok: true,
    action: operator ? "set" : "cleared",
    session: { harness: "claude", nativeSessionId: "a" },
    resolution: {
      name: operator ? name : "Harness title",
      source: operator ? "operator" : "harness",
      operatorName: name,
      derivedName: null,
      harnessTitle: "Harness title",
    },
  };
}
const headingProps = {
  identity: "local:session:claude:a",
  selector: "a",
  harness: "claude",
  title: "Harness A",
  named: false,
};

describe("renaming a session in place", () => {
  test("a new name is set as the runtime will store it", () => {
    expect(sessionNameEdit("  Session   names ", "kernel-panic", false)).toEqual({ kind: "set", name: "Session names" });
    expect(sessionNameEdit("x".repeat(200), "kernel-panic", false)).toEqual({ kind: "set", name: "x".repeat(120) });
  });

  test("the same name, or an empty one on a session nobody named, changes nothing", () => {
    expect(sessionNameEdit("kernel-panic", "kernel-panic", false)).toEqual({ kind: "unchanged" });
    expect(sessionNameEdit("   ", "kernel-panic", false)).toEqual({ kind: "unchanged" });
  });

  test("an empty name clears the operator's name", () => {
    expect(sessionNameEdit("", "Session names", true)).toEqual({ kind: "clear" });
  });

  test("Unicode limits match the runtime without splitting a surrogate pair", () => {
    const rockets = "\u{1f680}".repeat(121);
    expect(limitSessionName(rockets)).toBe("\u{1f680}".repeat(120));
    expect(sessionNameEdit(rockets, "Harness", false)).toEqual({ kind: "set", name: "\u{1f680}".repeat(120) });
  });

  test("Enter and Escape settle once, but composition Enter does nothing", async () => {
    mount();
    const commits: string[] = [];
    let cancels = 0;
    await renderField(commits, () => { cancels += 1; });
    let prevented = 0;
    const key = (isComposing: boolean) => ({
      key: "Enter",
      nativeEvent: { isComposing, keyCode: isComposing ? 229 : 13 },
      stopPropagation: () => {},
      preventDefault: () => { prevented += 1; },
    });
    field.compositionStart();
    field.keyDown(key(true) as never);
    expect(commits).toEqual([]);
    expect(cancels).toBe(0);
    expect(prevented).toBe(0);
    expect(sessionNameKeyAction("Enter", true)).toBeNull();
    field.compositionEnd();
    field.keyDown(key(false) as never);
    field.blur();
    expect(commits).toEqual(["Harness title"]);
    expect(prevented).toBe(1);
  });

  test("Escape cancels and a following blur does not save", async () => {
    mount();
    const commits: string[] = [];
    let cancels = 0;
    await renderField(commits, () => { cancels += 1; });
    field.keyDown({ key: "Escape", nativeEvent: { isComposing: false, keyCode: 27 }, stopPropagation: () => {}, preventDefault: () => {} } as never);
    field.blur();
    expect(commits).toEqual([]);
    expect(cancels).toBe(1);
    expect(sessionNameKeyAction("Escape", false)).toBe("cancel");
  });

  test("a late success cannot overwrite the session reached by navigation", async () => {
    const pending: PendingSave[] = [];
    let renamed = 0;
    mount(deferredFetch(pending));
    await renderHeading({ ...headingProps, onRenamed: () => { renamed += 1; } });
    await React.act(async () => { heading.commit("Name A"); await flush(); });
    expect(heading.current).toBe("Name A");
    await renderHeading({
      ...headingProps,
      identity: "local:session:claude:b",
      selector: "b",
      title: "Harness B",
      onRenamed: () => { renamed += 1; },
    });
    await React.act(async () => { pending[0]!.resolve(Response.json(savedName("Name A"))); await flush(); });
    expect(heading.current).toBe("Harness B");
    expect(heading.error).toBeNull();
    expect(renamed).toBe(0);
  });

  test("a late failure cannot report an error on another session", async () => {
    const pending: PendingSave[] = [];
    mount(deferredFetch(pending));
    await renderHeading(headingProps);
    await React.act(async () => { heading.commit("Name A"); await flush(); });
    await renderHeading({ ...headingProps, identity: "local:session:claude:b", selector: "b", title: "Harness B" });
    await React.act(async () => { pending[0]!.reject(new Error("old failure")); await flush(); });
    expect(heading.current).toBe("Harness B");
    expect(heading.error).toBeNull();
  });

  test("overlapping saves reach the runtime in order and only the newest updates the heading", async () => {
    const pending: PendingSave[] = [];
    let renamed = 0;
    mount(deferredFetch(pending));
    await renderHeading({ ...headingProps, onRenamed: () => { renamed += 1; } });
    await React.act(async () => { heading.commit("First name"); await flush(); });
    await React.act(async () => { heading.commit("Second name"); await flush(); });
    expect(pending.map((save) => save.body.name)).toEqual(["First name"]);
    await React.act(async () => { pending[0]!.resolve(Response.json(savedName("First name"))); await flush(); });
    expect(pending.map((save) => save.body.name)).toEqual(["First name", "Second name"]);
    expect(heading.current).toBe("Second name");
    await React.act(async () => { pending[1]!.resolve(Response.json(savedName("Second name"))); await flush(); });
    expect(heading.current).toBe("Second name");
    expect(heading.error).toBeNull();
    expect(renamed).toBe(1);
  });

  test("a failed earlier save does not block the next write", async () => {
    const pending: PendingSave[] = [];
    mount(deferredFetch(pending));
    await renderHeading(headingProps);
    await React.act(async () => { heading.commit("First name"); await flush(); });
    await React.act(async () => { heading.commit("Second name"); await flush(); });
    await React.act(async () => { pending[0]!.reject(new Error("first failed")); await flush(); });
    expect(pending.map((save) => save.body.name)).toEqual(["First name", "Second name"]);
    expect(heading.error).toBeNull();
    await React.act(async () => { pending[1]!.resolve(Response.json(savedName("Second name"))); await flush(); });
    expect(heading.current).toBe("Second name");
  });

  test("a failed current save restores the authoritative title and shows the error", async () => {
    const pending: PendingSave[] = [];
    mount(deferredFetch(pending));
    await renderHeading(headingProps);
    await React.act(async () => { heading.commit("Unsaved name"); await flush(); });
    await React.act(async () => { pending[0]!.reject(new Error("runtime unavailable")); await flush(); });
    expect(heading.current).toBe("Harness A");
    expect(heading.error).toBe("runtime unavailable");
  });
});
