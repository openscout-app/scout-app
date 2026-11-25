/**
 * A project's snapshot, GET /api/project-snapshot?path=<project root>: what the
 * Projects › Overview page reads beside the shared Projects loop and Repo Watch.
 * Pull requests and merges come from `gh`, main and the checkout from `git`, and
 * disk from the project root's file system. A part the server could not read is
 * null, with a warning, so the page says it is unknown instead of zero.
 *
 * Times are milliseconds.
 */

export type ProjectSnapshotPullRequest = {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: number;
  additions: number;
  deletions: number;
  /** MERGEABLE, CONFLICTING or UNKNOWN, as GitHub reports it */
  mergeable: string;
  headRefName: string;
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or null when the repo asks for none */
  reviewDecision: string | null;
};

export type ProjectSnapshotMerge = {
  number: number;
  title: string;
  url: string;
  mergedAt: number;
  additions: number;
  deletions: number;
};

export type ProjectSnapshot = {
  generatedAt: number;
  root: string;
  /** this host's name */
  host: string;
  /** the default branch on origin (as of the last fetch): its head */
  main: { ref: string; sha: string; subject: string; at: number } | null;
  /** the project root's own checkout against that branch */
  checkout: { branch: string | null; ahead: number; behind: number; uncommitted: number } | null;
  /** open pull requests, newest first */
  pullRequests: ProjectSnapshotPullRequest[] | null;
  /** pull requests merged in the last MERGED_WINDOW_MS, newest first */
  merged: ProjectSnapshotMerge[] | null;
  disk: { availableBytes: number; totalBytes: number } | null;
  warnings: string[];
};

export const MERGED_WINDOW_MS = 24 * 60 * 60 * 1000;
