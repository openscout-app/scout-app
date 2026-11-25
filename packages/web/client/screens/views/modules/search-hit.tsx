/**
 * Result — the selected search moment, in its conversation.
 *
 * Shows:  the moment's title, then project · harness · freshness · records.
 *         Open conversation, Observe window, Copy ref, Open file. Why it
 *         matched, the conversation around the match (folded records, turns
 *         that expand), the source path and the raw JSONL evidence. With
 *         nothing selected: Select a result, with the keys that walk the list.
 * Data:   the selected moment: on the Search route the page's (?hit=, held by
 *         Scout), anywhere else the latest pick of a Search panel on the same
 *         view (search-pick.ts). /api/knowledge/source-preview once per moment.
 * Scope:  none; it follows the Search page, or the Search panel beside it.
 * Opens:  Open conversation: that session. Observe window: Ops › Tail on the
 *         session. Open file: the file preview. Copy ref: the clipboard.
 */
import { useSyncExternalStore } from "react";
import { KnowledgeSearchInspector } from "../../search/right.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { resultSource } from "./search-panel-model.ts";
import { searchPicks } from "./search-pick.ts";
import "./search-panels.css";

function PickedResult({ navigate }: Pick<ModuleProps, "navigate">) {
  const pick = useSyncExternalStore(searchPicks.subscribe, searchPicks.latest, () => null);
  return (
    <KnowledgeSearchInspector
      navigate={navigate}
      selection={{ hit: pick?.hit ?? null, query: pick?.query ?? "", clear: () => pick?.clear() }}
    />
  );
}

function SearchHit({ route, navigate }: ModuleProps) {
  // a Search key (j, k, Esc) pressed in here still walks the Search list
  return (
    <div className="vw-search-hit" data-search-keys="companion">
      {resultSource(route) === "route" ? <KnowledgeSearchInspector navigate={navigate} /> : <PickedResult navigate={navigate} />}
    </div>
  );
}

export const searchHitModule = defineModule({
  type: "search-hit",
  title: "Result",
  blurb: "The selected search moment, in its conversation",
  docs: {
    shows: "The selected moment: meta, actions, why it matched, the conversation around it, raw evidence.",
    data: "The Search page's ?hit=, or a Search panel's pick on this view; /api/knowledge/source-preview per moment.",
    opens: "Open conversation: the session. Observe window: Ops › Tail. Open file: the file preview.",
  },
  size: { w: 5, h: 17 },
  minSize: { w: 3, h: 8 },
  maxPerView: 1,
  Component: SearchHit,
});
