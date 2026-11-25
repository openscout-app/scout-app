/**
 * What a For you card shows, from the server's card (shared/api/for-you.ts)
 * and Home's row. Pure, so the choices are tested: the digest leads when it
 * is in, the rules' facts stand in when it is not, and nothing is shown that
 * neither holds.
 */
import type { ForYouCard, ForYouKind, ForYouOption } from "../../../../shared/api/for-you.ts";

export type CardView = {
  kind: ForYouKind;
  /** The kind in a word, and what it is about: "Permission", "Bash". */
  label: string;
  about: string | null;
  /** The action, the question, the decision, the branch. */
  hero: string;
  heroMono: boolean;
  /** Scope and reason, a diff's size, a branch's commits: one line. */
  line: string | null;
  stake: string | null;
  options: ForYouOption[];
  defaultAction: string | null;
};

const LABEL: Record<ForYouKind, string> = {
  permission: "Permission",
  decision: "Decision",
  question: "Question",
  review: "Review",
  push: "Push",
  blocked: "Blocked",
};

function leaf(path: string | null | undefined): string | null {
  if (!path) return null;
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function lines(additions: number | null, deletions: number | null): string | null {
  if (additions === null && deletions === null) return null;
  return `+${additions ?? 0} −${deletions ?? 0}`;
}

function joined(parts: Array<string | null | undefined>): string | null {
  const kept = parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  return kept.length ? kept.join(" · ") : null;
}

/** The card's view, or null when it has nothing to lead with (the row is drawn instead). */
export function cardView(card: ForYouCard): CardView | null {
  const { facts, digest } = card;
  const base = { kind: card.kind, label: LABEL[card.kind], about: null, line: null, stake: digest?.stake ?? null, options: [], defaultAction: digest?.defaultAction ?? null, heroMono: false };
  switch (facts.kind) {
    case "permission": {
      const target = digest?.action?.target ?? facts.target;
      const hero = target ?? digest?.ask ?? facts.tool;
      if (!hero) return null;
      const scope = digest?.action?.scope ?? leaf(facts.scope);
      const reason = facts.reason ?? digest?.action?.reason ?? null;
      // With the target as the hero, the digest's ask says what it is for.
      const what = target && digest?.ask && digest.ask !== target ? digest.ask : null;
      return { ...base, about: facts.tool, hero, heroMono: Boolean(target), line: joined([what, scope ? `in ${scope}` : null, reason]) };
    }
    case "decision": {
      const hero = digest?.ask ?? facts.question;
      if (!hero) return null;
      const options = digest?.options.length ? digest.options : facts.options;
      return { ...base, hero, options, defaultAction: facts.defaultAction ?? base.defaultAction };
    }
    case "question": {
      const hero = digest?.ask ?? facts.question;
      return hero ? { ...base, hero } : null;
    }
    case "blocked": {
      const hero = digest?.ask ?? facts.stuckOn;
      return hero ? { ...base, hero } : null;
    }
    case "review": {
      // The change's size in one line; its files are plumbing, read in the Feed's expanded post.
      return {
        ...base,
        about: facts.pr.label,
        hero: facts.pr.title,
        line: joined([lines(facts.additions, facts.deletions), facts.fileCount !== null ? plural(facts.fileCount, "file") : null]),
      };
    }
    case "push":
      return {
        ...base,
        hero: facts.branch,
        heroMono: true,
        line: joined([facts.commits !== null ? plural(facts.commits, "commit") : null, lines(facts.additions, facts.deletions), "no pull request"]),
      };
  }
}
