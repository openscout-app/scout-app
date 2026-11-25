import { afterEach, describe, expect, mock, test } from "bun:test";

import type { Route } from "../../../lib/types.ts";
import type { RepoWatchSnapshot } from "../../../scout/repo-watch/types.ts";

/*
 * The Code view's panels, rendered to markup with the shared repo-watch
 * snapshot mocked (the pattern in projects-panels.test.ts). The highlighter
 * and the diff renderer are stubbed: they are the page's, unchanged.
 */

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../../../node_modules/react-dom/server.node.js");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);
mock.module("react-dom", () => ({ createPortal: (children: unknown) => children }));

const MAIN = "/example/workstation-user/dev/openscout";
const TALKIE = "/example/workstation-user/dev/talkie";

const worktree = (path: string, name: string, branch: string, files: { path: string; status: string }[], changedFiles = files.length) => ({
  id: `wt-${name}`,
  path,
  name,
  branch: { name: branch, detached: false },
  status: { clean: changedFiles === 0, changedFiles, files },
  diff: { branchShortstat: changedFiles ? "3 files changed, 12 insertions(+)" : null, unstagedShortstat: null, stagedShortstat: null },
});

const snapshot = {
  generatedAt: 1,
  projects: [
    {
      id: "p-openscout",
      name: "openscout",
      root: MAIN,
      worktrees: [
        worktree(MAIN, "openscout", "main", [
          { path: "packages/web/client/app.css", status: "unstaged" },
          { path: "notes.md", status: "untracked" },
        ], 3),
      ],
    },
    { id: "p-talkie", name: "talkie", root: TALKIE, worktrees: [worktree(TALKIE, "talkie", "main", [])] },
  ],
  totals: {},
  warnings: [],
} as unknown as RepoWatchSnapshot;

mock.module("../../code/code-snapshot.ts", () => ({
  useCodeSnapshot: () => snapshot,
  refreshCodeSnapshot: () => Promise.resolve(snapshot),
  pollCodeSnapshot: () => () => {},
}));
mock.module("../../code/ShikiPane.tsx", () => ({
  ShikiPane: ({ path }: { path: string }) => createElement("pre", { "data-shiki": path }),
}));
mock.module("../../code/CodeDiffPane.tsx", () => ({
  CodeDiffPane: ({ file }: { file: string }) => createElement("div", { "data-diff-pane": file }),
}));

const { codeFilesModule } = await import("./code-files.tsx");
const { codeFileModule } = await import("./code-file.tsx");
const { codeChangesModule } = await import("./code-changes.tsx");
const { codePicks } = await import("./code-pick.ts");
const { FOLLOW_PAGE } = await import("./panel-scope.ts");
const { ModuleHeadSlot } = await import("./ModuleHead.tsx");

const noop = () => undefined;

function renderPanel(module: { Component: unknown }, route: Route, config: Record<string, string> = {}, instanceId = "t"): string {
  const props = { instanceId, route, navigate: noop, config, setConfig: noop };
  // a head slot, so ModuleHead's chips draw inline (createPortal is mocked to pass its children through)
  return renderToStaticMarkup(
    createElement(ModuleHeadSlot.Provider, { value: {} as never }, createElement(module.Component as never, props as never)),
  );
}

afterEach(() => {
  for (const from of ["files", "changes"]) codePicks.withdraw(from);
});

describe("Changes", () => {
  test("on Code it follows the URL's checkout: branch, each change, what Repo Watch did not list", () => {
    const html = renderPanel(codeChangesModule, { view: "code", root: MAIN, file: `${MAIN}/notes.md` }, { root: FOLLOW_PAGE });
    expect(html).toContain('class="hud-grid-count">3<');
    expect(html).toContain(">Diff<");
    expect(html).toContain('class="vw-code-branch">main<');
    expect(html).toContain("3 files changed, 12 insertions(+)");
    expect(html).toContain('<span class="vw-code-dir">packages/web/client/</span>app.css');
    expect(html).toContain('class="vw-code-letter">M<');
    expect(html).toContain('class="vw-code-letter">U<');
    // the URL's file is the open one
    expect(html).toMatch(/data-selected="true"[^>]*title="notes\.md · untracked"/);
    expect(html).toContain("+1 more in the diff");
  });

  test("a clean checkout, and one Repo Watch does not list", () => {
    expect(renderPanel(codeChangesModule, { view: "search" }, { root: TALKIE })).toContain("Clean on main.");
    expect(renderPanel(codeChangesModule, { view: "search" }, { root: "/tmp/elsewhere" })).toContain("Repo Watch doesn&#x27;t list this checkout yet");
  });

  test("with nothing chosen it reads the repo of the file open beside it", () => {
    codePicks.publish("files", { root: TALKIE, file: `${TALKIE}/README.md` });
    expect(renderPanel(codeChangesModule, { view: "search" })).toContain("Clean on main.");
  });

  test("following a project page whose slug is still resolving names it", () => {
    const html = renderPanel(codeChangesModule, { view: "agents-v2", projectSlug: "ghost" }, { root: FOLLOW_PAGE });
    expect(html).toContain("Resolving “ghost”…");
  });
});

describe("File", () => {
  test("on Code a link still resolving says what it is opening", () => {
    const html = renderPanel(codeFileModule, { view: "code", project: "ghost", path: "AGENTS.md" }, { file: FOLLOW_PAGE });
    expect(html).toContain("Opening AGENTS.md…");
    expect(html).not.toContain("Open full");
    expect(html).not.toContain(">Pin<");
  });

  test("on Code it reads the URL's file, with no view switch before it loads and no Open full", () => {
    const html = renderPanel(codeFileModule, { view: "code", project: "openscout", path: "notes.md", line: 4 }, { file: FOLLOW_PAGE });
    expect(html).toContain('title="/example/workstation-user/dev/openscout/notes.md">notes.md<');
    // Preview and Source appear once the file shows it has both; Diff only when it changed
    expect(html).not.toContain(">Source<");
    expect(html).not.toContain(">Changes<");
    expect(html).not.toContain(">Diff<");
    expect(html).toContain("Copy scout://");
    expect(html).toContain(">Pin<");
    expect(html).not.toContain("Open full");
  });

  test("anywhere else it shows the file opened beside it", () => {
    expect(renderPanel(codeFileModule, { view: "search" })).toContain("Pick a file in Files and it opens here.");
    codePicks.publish("files", { root: MAIN, file: `${MAIN}/packages/web/client/app.css` });
    const html = renderPanel(codeFileModule, { view: "search" });
    expect(html).toContain(">packages/web/client/app.css<");
    expect(html).toContain(">Pin<");
    expect(html).toContain("Open full");
  });

  test("a pinned file holds, and offers Unpin", () => {
    codePicks.publish("files", { root: MAIN, file: `${MAIN}/notes.md` });
    const html = renderPanel(codeFileModule, { view: "search" }, { file: `${TALKIE}/README.md` });
    expect(html).toContain(">README.md<");
    expect(html).not.toContain("notes.md<");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Unpin</);
  });
});

describe("Files", () => {
  test("on Code: Back to thread, the picker on the URL's checkout, the tree reading", () => {
    const html = renderPanel(
      codeFilesModule,
      { view: "code", root: MAIN, file: `${MAIN}/notes.md`, returnConversationId: "c1" },
      { root: FOLLOW_PAGE },
    );
    expect(html).toContain("Back to thread");
    expect(html).toContain('class="s-code-pickerTrigger"');
    expect(html).toContain("3 files changed, 12 insertions(+)");
    expect(html).toContain('class="s-code-headPath"');
    expect(html).toContain("Loading…");
    expect(html).not.toContain("Open full");
  });

  test("anywhere else: no way back to a thread, Open full instead", () => {
    const html = renderPanel(codeFilesModule, { view: "search" }, { root: MAIN });
    expect(html).not.toContain("Back to thread");
    expect(html).toContain("Open full");
  });

  test("following a project page whose slug is still resolving names it", () => {
    const html = renderPanel(codeFilesModule, { view: "agents-v2", projectSlug: "ghost" }, { root: FOLLOW_PAGE });
    expect(html).toContain("Resolving “ghost”…");
  });
});
