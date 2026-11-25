import { useMemo, useSyncExternalStore } from "react";
import { snapshotRoots } from "../../code/code-browser-model.ts";
import { shortRootPath } from "../../code/code-project-picker-model.ts";
import { useCodeSnapshot } from "../../code/code-snapshot.ts";
import { readRecentRoots } from "../../code/code-tree-store.ts";
import type { ModuleScope, ModuleScopeOption } from "./contract.ts";
import { codePicks } from "./code-pick.ts";
import { fileOptionLabel } from "./code-panel-model.ts";

/*
 * The Code panels' Scope pickers: which checkout (Files, Changes) and which
 * file (File). Options are live: the checkouts Repo Watch knows plus the
 * repos read lately, and the files picked on this view.
 */

/** Every known checkout, then the roots read lately that it does not list. */
function useRootOptions(): readonly ModuleScopeOption[] {
  const snapshot = useCodeSnapshot();
  return useMemo(() => {
    const options: ModuleScopeOption[] = [];
    for (const project of snapshot?.projects ?? []) {
      for (const [index, worktree] of project.worktrees.entries()) {
        options.push({ value: worktree.path, label: index === 0 ? project.name : `${project.name} · ${worktree.name}` });
      }
    }
    const known = new Set(options.map((option) => option.value));
    for (const root of readRecentRoots()) if (!known.has(root)) options.push({ value: root, label: shortRootPath(root) });
    return options;
  }, [snapshot]);
}

function useFileOptions(): readonly ModuleScopeOption[] {
  const snapshot = useCodeSnapshot();
  const recent = useSyncExternalStore(codePicks.subscribe, codePicks.recent, codePicks.recent);
  return useMemo(() => {
    const roots = snapshotRoots(snapshot);
    return recent.map((file) => ({ value: file, label: fileOptionLabel(file, roots) }));
  }, [recent, snapshot]);
}

export const CODE_ROOT_SCOPE: ModuleScope = {
  key: "root",
  allLabel: "Last repo read",
  followsPage: "This page's repo",
  useOptions: useRootOptions,
};

/** Changes: with nothing chosen it reads the repo of the file open beside it. */
export const CODE_CHANGES_ROOT_SCOPE: ModuleScope = {
  ...CODE_ROOT_SCOPE,
  allLabel: "Repo open beside it",
};

export const CODE_FILE_SCOPE: ModuleScope = {
  key: "file",
  allLabel: "Picked in Files",
  followsPage: "This page's file",
  useOptions: useFileOptions,
};
