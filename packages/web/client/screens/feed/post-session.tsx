/*
 * The parts of a detailed (L) Feed item read from its owner's session: the
 * turn's steps in brief, each changed file's diff folded on its own, and the
 * session's last lines. They mount only when the item opens, so the stream
 * never reads a session or a diff.
 */
import { useEffect, useMemo, useState } from "react";
import { recordedSession } from "../../lib/post-record-routes.ts";
import { formatSessionRouteRef } from "../../lib/session-route-ref.ts";
import type { FeedPostHead } from "../../../shared/api/feed.ts";
import { useSessionRefLookup } from "../sessions/use-session-ref-lookup.ts";
import { api } from "../../lib/api.ts";
import type { ScoutRepoDiffSnapshot } from "../../lib/types.ts";
import { ChangeLine, G, Glyph } from "./post-parts.tsx";
import { useFeedCapabilities } from "./feed-capabilities.tsx";
import { mergeDiffFiles, patchFiles, readSession, type BriefStep, type DiffFile, type SessionRead } from "./post-session-model.ts";

export type SessionReadState = {
  read: SessionRead | null;
  reading: boolean;
  failed: boolean;
  /** Files changed with their diffs: the post's commit from git, else the trace's previews; null while git is read. */
  files: { from: "commit" | "trace"; list: DiffFile[] } | null;
};

/** Checkouts that hold a post's commit: its folder, then the repository a `.scout-worktrees` copy sits in. */
export function checkoutsFor(cwd: string | null | undefined): string[] {
  const path = cwd?.trim();
  if (!path) return [];
  const at = path.indexOf("/.scout-worktrees/");
  return at > 0 ? [path, path.slice(0, at)] : [path];
}

/** The commit's change against `baseRef` (the server diffs from their merge base), in `path`'s checkout. */
async function commitPatch(path: string, baseRef: string, sha: string): Promise<DiffFile[]> {
  const params = new URLSearchParams({ path, layer: "branch", baseRef, compareRef: sha, tier: "patch", cache: "prefer" });
  const snapshot = await api<ScoutRepoDiffSnapshot>(`/api/repo-diff/worktree?${params.toString()}`);
  return mergeDiffFiles(snapshot.layers.map((layer) => (layer.rawPatch ? patchFiles(layer.rawPatch) : [])));
}

/**
 * The post's change from git, file by file: its commit against where it left
 * main, or, once it is on main, against its parent. Empty when no checkout
 * holds the commit.
 */
function useCommitDiff(sha: string | null, cwd: string | null | undefined): DiffFile[] | null {
  const [files, setFiles] = useState<DiffFile[] | null>(sha ? null : []);
  const checkouts = checkoutsFor(cwd).join("\n");
  useEffect(() => {
    if (!sha) { setFiles([]); return; }
    let live = true;
    setFiles(null);
    (async () => {
      for (const path of checkouts.split("\n").filter(Boolean)) {
        for (const base of ["origin/main", `${sha}~1`]) {
          try {
            const found = await commitPatch(path, base, sha);
            if (found.length) return found;
          } catch {
            break; // This checkout cannot read it; try the next.
          }
        }
      }
      return [];
    })().then((found) => { if (live) setFiles(found); });
    return () => { live = false; };
  }, [sha, checkouts]);
  return files;
}

/** The owner's session, read once the item opens. A post with no session reads nothing. */
export function useSessionRead(post: FeedPostHead, sha: string | null): SessionReadState {
  const { readOnly } = useFeedCapabilities();
  const id = post.owner.sessionId;
  const ref = readOnly ? recordedSession(post) ?? "" : id ? formatSessionRouteRef(post.agent.harness, id) ?? id : "";
  const { lookup, loading, error } = useSessionRefLookup(ref, !readOnly);
  const data = lookup?.kind === "observe" ? lookup.observe.data : null;
  const read = useMemo(() => (data ? readSession(data, post.at) : null), [data, post.at]);
  const commit = useCommitDiff(sha, post.owner.cwd);
  const files: SessionReadState["files"] = commit === null ? null
    : commit.length ? { from: "commit", list: commit }
    : { from: "trace", list: read?.files ?? [] };
  return { read, reading: Boolean(ref) && loading && !data, failed: Boolean(ref) && !loading && !data && Boolean(error), files };
}

/** The turn's steps, one line each: what the agent said, then what it did. */
export function StepsBrief({ steps, more }: { steps: readonly BriefStep[]; more: number }) {
  return (
    <ol className="pd-steps">
      {steps.map((step) => (
        <li key={step.id} className="pd-stepsRow" data-failed={step.failed || undefined}>
          {step.say ? <span className="pd-stepsSay">{step.say}</span> : null}
          <span className="pd-stepsDid">
            {step.did}
            {step.add || step.del ? <ChangeLine change={{ files: null, additions: step.add, deletions: step.del }} /> : null}
            {step.failed ? <span className="fd-del">failed</span> : null}
          </span>
        </li>
      ))}
      {more ? <li className="pd-small">{more} more {more === 1 ? "step" : "steps"} in the session</li> : null}
    </ol>
  );
}

function lineKind(line: string): "add" | "del" | "hunk" | null {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return null;
}

/** One file's diff, folded: its name and size open its lines. */
function FileDiff({ file }: { file: DiffFile }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="pd-file">
      <button type="button" className="pd-fold pd-fileHead" aria-expanded={open} onClick={() => setOpen(!open)} title={file.path}>
        <span className="pd-foldIcon" data-open={open || undefined}><Glyph d={G.chevron} size={11} /></span>
        <span className="pd-fileName">{file.path}</span>
        <ChangeLine change={{ files: null, additions: file.add, deletions: file.del }} />
      </button>
      {open ? (
        <pre className="pd-patch">
          {file.lines.map((line, i) => <span key={i} className="pd-patchLine" data-kind={lineKind(line) ?? undefined}>{line === "@@" ? "⋯" : line}</span>)}
          {file.cut ? <span className="pd-patchLine" data-kind="hunk">{file.cut} more lines</span> : null}
        </pre>
      ) : null}
    </li>
  );
}

export function FileDiffs({ files }: { files: readonly DiffFile[] }) {
  return <ul className="pd-files">{files.map((file) => <FileDiff key={file.path} file={file} />)}</ul>;
}

/** The session's newest lines, as the agent wrote them. */
export function LastLines({ lines }: { lines: readonly string[] }) {
  return <div className="pd-last">{lines.map((line, i) => <p key={i} className="pd-lastLine">{line}</p>)}</div>;
}
