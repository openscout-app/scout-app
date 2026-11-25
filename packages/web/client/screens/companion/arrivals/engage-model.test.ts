import { describe, expect, test } from "bun:test";

import {
  ENGAGE_REFUSED,
  addFigureFiles,
  clearFigureFiles,
  dropOnFigure,
  engageRoute,
  figureFiles,
  removeFigureFile,
  sentEcho,
  subscribeFigureFiles,
  talkLines,
  withPaths,
  type EngageFile,
} from "./engage-model.ts";

const shot = (over: Partial<EngageFile> = {}): EngageFile => ({
  id: "b1", mediaType: "image/png", fileName: "Screenshot 10.12.png", url: "/api/blobs/b1",
  localPath: "/example/workstation-user/.scout/blobs/named/b1/Screenshot 10.12.png", ...over,
});

describe("which way a reply with files goes", () => {
  test("text alone goes the way it always did", () => {
    expect(engageRoute({ kind: "native", local: false, conversationId: null }, " Run it ")).toEqual({ via: "session", text: "Run it" });
    expect(engageRoute({ kind: "work", local: true, conversationId: "c1" }, "Run it")).toEqual({ via: "thread", conversationId: "c1", text: "Run it", attachments: [] });
    expect(engageRoute({ kind: "work", local: true, conversationId: null }, "Run it")).toEqual({ via: "none", reason: ENGAGE_REFUSED.NO_THREAD });
  });

  test("a session on this host is typed the text and each file's path, on one line", () => {
    const r = engageRoute({ kind: "native", local: true, conversationId: "c1" }, "Look at this", [shot(), shot({ id: "b2", localPath: "/tmp/b2.png" })]);
    expect(r).toEqual({ via: "session", text: "Look at this \"/example/workstation-user/.scout/blobs/named/b1/Screenshot 10.12.png\" /tmp/b2.png" });
    // Just the file.
    expect(engageRoute({ kind: "native", local: true, conversationId: null }, "", [shot({ localPath: "/tmp/a.png" })])).toEqual({ via: "session", text: "/tmp/a.png" });
  });

  test("elsewhere, the thread takes the blobs as attachments, never a path on this host", () => {
    const r = engageRoute({ kind: "native", local: false, conversationId: "c1" }, "Look", [shot()]);
    expect(r).toEqual({ via: "thread", conversationId: "c1", text: "Look", attachments: [{ id: "b1", mediaType: "image/png", fileName: "Screenshot 10.12.png", url: "/api/blobs/b1" }] });
    const w = engageRoute({ kind: "work", local: true, conversationId: "c2" }, "", [shot()]);
    expect(w.via === "thread" && w.attachments[0]).not.toHaveProperty("localPath");
  });

  test("no thread and no path: refused, with why", () => {
    expect(engageRoute({ kind: "native", local: false, conversationId: null }, "Look", [shot()])).toEqual({ via: "none", reason: ENGAGE_REFUSED.REMOTE });
    expect(engageRoute({ kind: "native", local: true, conversationId: null }, "Look", [shot({ localPath: null })])).toEqual({ via: "none", reason: ENGAGE_REFUSED.NO_PATH });
  });

  test("a session nothing holds on this host is resumed with the reply, its files as paths, even with a thread", () => {
    expect(engageRoute({ kind: "native", local: true, conversationId: "c1", resume: true }, " Go on ")).toEqual({ via: "resume", text: "Go on" });
    expect(engageRoute({ kind: "native", local: true, conversationId: "c1", resume: true }, "Look", [shot({ localPath: "/tmp/a.png" })]))
      .toEqual({ via: "resume", text: "Look /tmp/a.png" });
    expect(engageRoute({ kind: "native", local: true, conversationId: null, resume: true }, "Look", [shot({ localPath: null })]))
      .toEqual({ via: "none", reason: ENGAGE_REFUSED.NO_PATH });
    // Not on this host: never resumed from here.
    expect(engageRoute({ kind: "native", local: false, conversationId: null, resume: true }, "Go on")).toEqual({ via: "session", text: "Go on" });
    // A work row has no session to resume.
    expect(engageRoute({ kind: "work", local: true, conversationId: "c1", resume: true }, "Go on").via).toBe("thread");
  });

  test("a path with a quote in it stays one word", () => {
    expect(withPaths("", ["/a b/\"c\".png"])).toBe("\"/a b/\\\"c\\\".png\"");
  });
});

describe("the engage panel's lines", () => {
  const line = (id: string, you: boolean, text: string, at: number | null = null) => ({ id, you, text, at });
  const history = [line("u1", true, "Run the tests", 1), line("a1", false, "All pass.", 2)];

  test("the turns, then your reply until the reads have it, then a demo's answer", () => {
    expect(talkLines({ history, sent: { text: "Open a PR", at: 3 } }).map((l) => l.text)).toEqual(["Run the tests", "All pass.", "Open a PR"]);
    expect(talkLines({ history: [...history, line("u2", true, "Open a PR", 3)], sent: { text: "Open a PR", at: 3 } })).toHaveLength(3);
    expect(talkLines({ history, sent: { text: "Open a PR", at: 3 }, answer: "On it." }).at(-1)).toEqual(line("answer", false, "On it."));
  });

  test("what the work raised ends the lines when the turns don't say it; the ask on top is not said twice", () => {
    expect(talkLines({ history, callout: "Blocked on the token" }).at(-1)!.text).toBe("Blocked on the token");
    expect(talkLines({ history, callout: "All pass." })).toHaveLength(2);
    expect(talkLines({ history, hide: ["All pass.", null] }).map((l) => l.text)).toEqual(["Run the tests"]);
  });

  test("the last few only", () => {
    const many = Array.from({ length: 9 }, (_, i) => line(`l${i}`, i % 2 === 0, `line ${i}`, i));
    expect(talkLines({ history: many }).map((l) => l.id)).toEqual(["l4", "l5", "l6", "l7", "l8"]);
  });

  test("a reply with files echoes its text and their names", () => {
    expect(sentEcho(" Look ", [{ fileName: "shot.png" }, { fileName: undefined }])).toBe("Look · shot.png, file");
    expect(sentEcho("", [{ fileName: "shot.png" }])).toBe("shot.png");
  });
});

describe("files held for a figure", () => {
  test("added once each, removed one at a time, cleared on send; listeners hear each change", () => {
    let heard = 0;
    const off = subscribeFigureFiles(() => { heard += 1; });
    addFigureFiles("w1", [shot()]);
    addFigureFiles("w1", [shot(), shot({ id: "b2" })]);
    expect(figureFiles("w1").files.map((f) => f.id)).toEqual(["b1", "b2"]);
    const snapshot = figureFiles("w1");
    expect(figureFiles("w1")).toBe(snapshot);
    removeFigureFile("w1", "b1");
    expect(figureFiles("w1").files.map((f) => f.id)).toEqual(["b2"]);
    clearFigureFiles("w1");
    expect(figureFiles("w1").files).toEqual([]);
    expect(heard).toBe(4);
    off();
  });

  test("a drop says it is attaching, then holds the files, or says why not", async () => {
    let attaching = -1;
    const pending = dropOnFigure("w2", [], async () => { attaching = figureFiles("w2").attaching; return [shot()]; });
    expect(await pending).toBe(true);
    expect(attaching).toBe(1);
    expect(figureFiles("w2")).toMatchObject({ attaching: 0, note: null });
    expect(figureFiles("w2").files.map((f) => f.id)).toEqual(["b1"]);
    expect(await dropOnFigure("w2", [], async () => { throw new Error("Drop an image, a video, markdown or code."); })).toBe(false);
    expect(figureFiles("w2")).toMatchObject({ attaching: 0, note: "Drop an image, a video, markdown or code." });
    expect(figureFiles("w2").files).toHaveLength(1);
    clearFigureFiles("w2");
  });
});
