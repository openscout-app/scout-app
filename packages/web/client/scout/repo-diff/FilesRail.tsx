import { Plus } from "lucide-react";
import { Fragment, useCallback, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  fileDisplayPath,
  fileKey,
  splitPath,
  STATUS_GLYPH,
} from "./model.ts";
import type {
  RepoDiffFile,
  RepoDiffLayer,
} from "./types.ts";

const RAIL_WIDTH_KEY = "openscout.repo-diff.files-rail-width";
const DEFAULT_RAIL_WIDTH = 268;
const MIN_RAIL_WIDTH = 240;
const MAX_RAIL_WIDTH = 520;

/**
 * A file name split where a line may break: between camelCase words and
 * after a dash or underscore; the extension stays on the last word. The rail
 * wraps a long name at those points rather than cutting it
 * ("Scout|Root|View.swift").
 */
export function fileNameBreaks(name: string): string[] {
  return name.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[-_])/).filter(Boolean);
}

function BreakableName({ name }: { name: string }) {
  const parts = fileNameBreaks(name);
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <wbr /> : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}

export type FileEntry = {
  file: RepoDiffFile;
  index: number;
  key: string;
  display: string;
  name: string;
  dir: string;
  renamed: boolean;
};

export type FileTreeNode = {
  name: string;
  path: string;
  firstIndex: number;
  children: Map<string, FileTreeNode>;
  files: FileEntry[];
};

function clampRailWidth(width: number): number {
  return Math.max(MIN_RAIL_WIDTH, Math.min(MAX_RAIL_WIDTH, Math.round(width)));
}

function initialRailWidth(): number {
  if (typeof window === "undefined") return DEFAULT_RAIL_WIDTH;
  const stored = Number(window.localStorage.getItem(RAIL_WIDTH_KEY));
  return Number.isFinite(stored) ? clampRailWidth(stored) : DEFAULT_RAIL_WIDTH;
}

export function buildFileTree(entries: FileEntry[]): FileTreeNode {
  const root: FileTreeNode = { name: "", path: "", firstIndex: Number.MAX_SAFE_INTEGER, children: new Map(), files: [] };
  for (const entry of entries) {
    root.firstIndex = Math.min(root.firstIndex, entry.index);
    const parts = entry.dir ? entry.dir.split("/").filter(Boolean) : [];
    let node = root;
    for (const part of parts) {
      const path = node.path ? `${node.path}/${part}` : part;
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, path, firstIndex: entry.index, children: new Map(), files: [] };
        node.children.set(part, child);
      }
      child.firstIndex = Math.min(child.firstIndex, entry.index);
      node = child;
    }
    node.files.push(entry);
  }
  return root;
}

/**
 * Fold a folder that holds only one folder into it ("apps/macos/Sources"), as
 * editors do, so deep single-file paths don't spend the rail's width on
 * indentation. The folded node keeps the deepest path (the collapse key).
 */
export function compactFileTree(node: FileTreeNode): FileTreeNode {
  const children = new Map<string, FileTreeNode>();
  for (const [key, original] of node.children) {
    let child = original;
    while (child.files.length === 0 && child.children.size === 1) {
      const only = [...child.children.values()][0];
      child = { ...only, name: `${child.name}/${only.name}` };
    }
    children.set(key, compactFileTree(child));
  }
  return { ...node, children };
}

function treeFileCount(node: FileTreeNode): number {
  let count = node.files.length;
  for (const child of node.children.values()) count += treeFileCount(child);
  return count;
}

export function FilesRail({
  layer,
  selectedFileKey,
  onSelect,
  onIncludeFile,
}: {
  layer: RepoDiffLayer | null;
  selectedFileKey: string | null;
  onSelect: (key: string) => void;
  onIncludeFile: (file: RepoDiffFile, key: string) => void;
}) {
  const [width, setWidth] = useState(initialRailWidth);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const entries = useMemo<FileEntry[]>(() => (layer?.files ?? []).map((file, index) => {
    const key = fileKey(file, index);
    const display = fileDisplayPath(file);
    const { name, dir } = splitPath(display);
    const renamed =
      (file.status === "renamed" || file.status === "copied") &&
      file.oldPath &&
      file.newPath &&
      file.oldPath !== file.newPath;
    return { file, index, key, display, name, dir, renamed: Boolean(renamed) };
  }), [layer]);
  const tree = useMemo(() => compactFileTree(buildFileTree(entries)), [entries]);

  const toggleDirectory = useCallback((path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const beginResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      setWidth(clampRailWidth(startWidth + moveEvent.clientX - startX));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setWidth((current) => {
        const next = clampRailWidth(current);
        window.localStorage.setItem(RAIL_WIDTH_KEY, String(next));
        return next;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [width]);

  const renderFile = (entry: FileEntry, depth: number) => (
    <FileRow
      key={entry.key}
      entry={entry}
      depth={depth}
      selected={entry.key === selectedFileKey}
      onSelect={onSelect}
      onIncludeFile={onIncludeFile}
    />
  );

  const renderNode = (node: FileTreeNode, depth: number): ReactNode[] => {
    const rows: ReactNode[] = [];
    const children = [...node.children.values()].sort((left, right) => {
      if (left.firstIndex !== right.firstIndex) return left.firstIndex - right.firstIndex;
      return left.name.localeCompare(right.name);
    });
    for (const child of children) {
      const isCollapsed = collapsed.has(child.path);
      rows.push(
        <button
          key={`dir:${child.path}`}
          type="button"
          className="rd-dir-row"
          style={{ paddingLeft: 8 + depth * 10 }}
          onClick={() => toggleDirectory(child.path)}
          title={child.path}
        >
          <span className="rd-dir-caret">{isCollapsed ? "›" : "⌄"}</span>
          <span className="rd-dir-name">{child.name}</span>
          <span className="rd-dir-count">{treeFileCount(child)}</span>
        </button>,
      );
      if (!isCollapsed) {
        rows.push(...renderNode(child, depth + 1));
      }
    }
    for (const entry of node.files) rows.push(renderFile(entry, depth));
    return rows;
  };

  return (
    <div className="rd-rail" style={{ width }}>
      <div className="rd-rail-head">
        {layer ? `Changed files · ${layer.files.length}` : "Changed files"}
      </div>
      <div className="rd-rail-list">
        {renderNode(tree, 0)}
      </div>
      <div
        className="rd-rail-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file navigation"
        onPointerDown={beginResize}
      />
    </div>
  );
}

function FileRow({
  entry,
  depth,
  selected,
  onSelect,
  onIncludeFile,
}: {
  entry: FileEntry;
  depth: number;
  selected: boolean;
  onSelect: (key: string) => void;
  onIncludeFile: (file: RepoDiffFile, key: string) => void;
}) {
  const { file, key, display, name, renamed } = entry;
  return (
    <div
      className={"rd-file-row" + (selected ? " on" : "")}
      title={renamed ? `${file.oldPath} → ${file.newPath}` : display}
    >
      <button
        type="button"
        className="rd-file-pick"
        style={{ paddingLeft: 10 + depth * 10 }}
        onClick={() => onSelect(key)}
      >
        <span className={`rd-file-glyph ${file.status}`}>
          {STATUS_GLYPH[file.status]}
        </span>
        <span className="rd-file-id">
          {/* the full name, wrapping when the rail is narrow: never cut */}
          <span className="rd-file-name"><BreakableName name={name} /></span>
          {/* the tree already shows the folders; only a rename needs a path line */}
          {renamed ? <span className="rd-file-dir">{`from ${file.oldPath}`}</span> : null}
          <FileTags file={file} />
        </span>
      </button>
      <span className="rd-file-churn">
        {file.binary ? (
          <span className="bin">bin</span>
        ) : (
          <>
            <span className="add">+{file.additions ?? 0}</span>
            <span className="del">−{file.deletions ?? 0}</span>
          </>
        )}
      </span>
      <button
        type="button"
        className="rd-file-include"
        onClick={(event) => {
          event.stopPropagation();
          onIncludeFile(file, key);
        }}
        aria-label={`Include ${display} in comment`}
        title="Include in comment"
      >
        <Plus size={12} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}

function FileTags({ file }: { file: RepoDiffFile }) {
  const tags: string[] = [];
  if (file.binary) tags.push("BINARY");
  if (file.truncated) tags.push("TRUNCATED");
  if (file.status === "conflict") tags.push("CONFLICT");
  if (tags.length === 0) return null;
  return (
    <span className="rd-file-tags">
      {tags.map((t) => (
        <span key={t} className="rd-file-tag">
          {t}
        </span>
      ))}
    </span>
  );
}
