import { useMemo } from "react";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { HerdrMark } from "../../components/HerdrMark.tsx";
import { resolveAgentTerminalSurface } from "../../lib/terminal-relay.ts";
import {
  surfaceKey,
  terminalListItems,
  type RegisteredTerminalTarget,
  type TerminalListItem,
} from "../../lib/terminal-sessions.ts";
import { useTerminalSources } from "../../lib/terminal-sources.ts";
import type { Agent } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import {
  terminalItemSourceRef,
  terminalNavRow,
  type TerminalNavRowMark,
  type TerminalNavRowModel,
} from "./terminal-nav-row.ts";

/**
 * One terminal's name and mark, as the Terminals list shows it. The session
 * view and the details panel read the same model, so a terminal is called the
 * same thing everywhere it appears, and never by its raw session id when
 * anything better is known.
 */

/** The agent whose terminal surface is this item's, if one is on the roster. */
export function terminalOwnerAgent(agents: readonly Agent[], item: TerminalListItem): Agent | null {
  return agents.find((agent) => {
    const surface = resolveAgentTerminalSurface(agent);
    return surface != null
      && surface.backend === item.surface.backend
      && surface.sessionName === item.surface.sessionName;
  }) ?? null;
}

const NO_REFS: readonly string[] = [];

export function useTerminalRowIdentity(target: RegisteredTerminalTarget | null): TerminalNavRowModel | null {
  const { agents } = useScout();
  const item = useMemo(
    () => target
      ? terminalListItems([target.session]).find((candidate) => surfaceKey(candidate.surface) === surfaceKey(target.surface)) ?? null
      : null,
    [target],
  );
  const ref = item ? terminalItemSourceRef(item) : null;
  const refs = useMemo(() => (ref ? [ref] : NO_REFS), [ref]);
  const sources = useTerminalSources(refs);
  return useMemo(() => {
    if (!item) return null;
    return terminalNavRow(item, terminalOwnerAgent(agents, item), null, {
      source: ref ? sources.get(ref) ?? null : null,
    });
  }, [agents, item, ref, sources]);
}

/** The harness or herdr glyph a row leads with; a plain shell shows nothing. */
export function TerminalRowMark({ mark, size = 16 }: { mark: TerminalNavRowMark; size?: number }) {
  if (mark.kind === "herdr") return <HerdrMark size={size} title={null} />;
  if (mark.kind === "harness") return <HarnessMark harness={mark.harness} size={size} title={null} />;
  return null;
}
