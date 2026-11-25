import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildModel, clock } from "./model.ts";
import { Pane, openTab } from "./pane.tsx";
import type { ReviewData } from "../../../shared/review-window.ts";

test("a pinned file opened under worktree focus renders that copy in the code pane", () => {
  const d: ReviewData = {
    from: 0, now: 100000, host: "", days: 1, kinds: ["e"], strs: ["~/app/a.png", "app:a.png", "Edit"],
    projects: { app: "~/app" }, wts: [["app", "main", "~/app", 0], ["app", "b", "~/app-b", 0]],
    files: [[0, 0, 1]], calls: [[1, 0, 0, 2, 0, 0, 0, 1, 0], [2, 0, 0, 2, 1, 0, 0, 1, 0]],
    sessions: [{ sid: "session", h: "claude", agent: -1, turns: [], colds: [], errs: [] }],
    actors: [], asks: [], commits: [], changes: [],
    current: { "app:a.png": { path: "~/app-b/a.png", w: 1, mt: 2, image: true } },
    currentByWorktree: {
      '["app:a.png",0]': { path: "~/app/a.png", w: 0, mt: 1, image: true },
      '["app:a.png",1]': { path: "~/app-b/a.png", w: 1, mt: 2, image: true },
    },
  };
  const m = buildModel(d);
  const opened = openTab([], { type: "art", key: "app:a.png", v: null, pin: true });
  const noop = () => {};
  const render = (w: number) => renderToStaticMarkup(<Pane m={m} scope={{ kind: "wt", w }} ck={clock(m)}
    tabs={opened.tabs} at={opened.at} wide={true} onAt={noop} onPin={noop} onClose={noop} onCloseAll={noop}
    onView={noop} onWide={noop} onGrip={noop} onArt={noop} onCommit={noop} onSession={noop} />);
  const a = render(0), b = render(1);
  expect(a).toContain("p=~%2Fapp%2Fa.png");
  expect(a).not.toContain("p=~%2Fapp-b%2Fa.png");
  expect(b).toContain("p=~%2Fapp-b%2Fa.png");
});
