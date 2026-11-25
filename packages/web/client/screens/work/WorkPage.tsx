import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { hostFleet } from "../../lib/hosts/host-fleet.ts";
import { LOCAL_HOST_ID } from "../../lib/hosts/host-client.ts";
import { machineScopedAgentIds } from "../../lib/machine-scope.ts";
import { routeMachineId } from "../../lib/router.ts";
import { timeAgo } from "../../lib/time.ts";
import type { Route, WorkDetail } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { DockedSide, useDockedSides, type DockedPanel } from "../views/DockedSides.tsx";
import type { ViewComposition, ViewSide } from "../views/views-model.ts";
import type { ViewModuleDef } from "../views/modules/contract.ts";
import { FOLLOW_PAGE } from "../views/modules/follow-page.ts";
import { workFilesModule } from "../views/modules/work-files.tsx";
import { workFlightsModule } from "../views/modules/work-flights.tsx";
import { workItemModule } from "../views/modules/work-item.tsx";
import { workPeopleModule } from "../views/modules/work-people.tsx";
import { workTailModule } from "../views/modules/work-tail.tsx";
import { workTimelineModule } from "../views/modules/work-timeline.tsx";
import { filterWorkByAgents, workListPath, workListRows, workOwnerLabel, workRoute, workRowMark } from "../views/modules/work-view-model.ts";
import { useWorkDetail, useWorkList } from "./use-work-detail.ts";
import { BoardReviewTicket, isBoardReviewWorkId } from "./BoardReviewTicket.tsx";
import { WorkRunActions } from "./WorkCasefileSections.tsx";
import {
  BELOW_SHARE_DEFAULT,
  belowShareAfterDrag,
  parseBelowShare,
  workDetailTabs,
  defaultWorkTab,
  type WorkArrangement,
  type WorkTab,
} from "./work-page-model.ts";
import "../views/views.css";
import "../views/modules/work-panels.css";
import "./work-page.css";

/*
 * /work and /work/:id. The work list docked on the left, the work item in the
 * middle, and its Flight, Timeline, Tail and Files in one tabbed pane. The
 * pane is docked on the right (Side, the default) or sits under the item at
 * full width (Below). The docked sides are the views' own (DockedSides): they
 * drag to any width, fold to a strip, and remember both per viewer. Below,
 * the seam between the item and the pane drags the same way.
 */

type Navigate = (route: Route, options?: { replace?: boolean }) => void;
type WorkRow = ReturnType<typeof workListRows>[number];

const ARRANGEMENT_KEY = "scout.work.arrangement";
const BELOW_SHARE_KEY = "scout.work.below-share";

function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // a private window keeps the choice for this page only
  }
}

function usePref<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const saved = typeof window === "undefined" ? null : readPref(key);
    return allowed.includes(saved as T) ? (saved as T) : fallback;
  });
  return [value, (next: T) => { setValue(next); writePref(key, next); }];
}

/** The page's docked sides, as a composition with nothing on its grid: the list left, the detail right. */
function workSides(listDocked: boolean, detailDocked: boolean): ViewComposition {
  return {
    id: "work-page",
    label: "Work",
    intent: "Follow one work item, with the other work beside it.",
    instances: [],
    layout: [],
    sides: { left: listDocked ? ["work-list"] : [], right: detailDocked ? ["work-detail"] : [] },
    sideWidth: { left: 280, right: 460 },
  };
}

const noConfig = () => {};
const FOLLOW = { work: FOLLOW_PAGE } as const;

function Part({ module, route, navigate, id }: { module: ViewModuleDef; route: Route; navigate: Navigate; id: string }) {
  const Component = module.Component;
  return <Component instanceId={id} route={route} navigate={navigate} config={FOLLOW} setConfig={noConfig} />;
}

function SideGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
      <rect x="2.5" y="3.5" width="11" height="9" />
      <path d="M9.5 3.5v9" />
    </svg>
  );
}

function BelowGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
      <rect x="2.5" y="3.5" width="11" height="9" />
      <path d="M2.5 8.5h11" />
    </svg>
  );
}

/* The detail tabs' marks: drawn for this page at 12px, one stroke weight, no fill. */
const TAB_GLYPHS: Record<WorkTab, ReactNode> = {
  // a run: a line leaving its start for its target
  flight: <><circle cx="2.75" cy="9.25" r="1.25" /><path d="M4 8 9.5 2.5M6 2.5h3.5V6" /></>,
  // a timeline: a rail with three moments on it
  timeline: <><path d="M1.5 6h9" /><circle cx="3" cy="6" r="1.1" /><circle cx="6.5" cy="6" r="1.1" /><circle cx="9.5" cy="6" r="1.1" /></>,
  // a tail: output lines under a prompt
  tail: <path d="M1.5 2.5 3.5 4.25 1.5 6M5 5.5h5.5M1.5 8h9M1.5 10.5h6" />,
  // a file: a page with its corner folded
  files: <path d="M2.5 1.5h4.25L9.5 4.25v6.25h-7zM6.5 1.5v3h3" />,
};

function TabGlyph({ tab }: { tab: WorkTab }) {
  return (
    <svg className="wp-tab-glyph" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      {TAB_GLYPHS[tab]}
    </svg>
  );
}

/** A panel head's title and its count, as the views draw them: the count a step off the title. */
function HeadTitle({ text, count, countRef }: { text: string; count?: ReactNode; countRef?: (el: HTMLElement | null) => void }) {
  return (
    <>
      <span className="vw-title-text">{text}</span>
      <span className="vw-count-slot">{count != null && <span className="hud-grid-count" ref={countRef}>{count}</span>}</span>
    </>
  );
}

const STATE_WORDS: Record<string, string> = { working: "Working", waiting: "Waiting", review: "In review", blocked: "Blocked", done: "Done" };

function useWorkRows(route: Route) {
  const { agents } = useScout();
  const { value, error } = useWorkList(workListPath("all"));
  const machineId = routeMachineId(route);
  const agentIds = useMemo(() => machineScopedAgentIds(agents, machineId), [agents, machineId]);
  const items = useMemo(() => workListRows(filterWorkByAgents(value ?? [], agentIds), undefined), [agentIds, value]);
  return { items, read: !!value, error };
}

/** The list of work. Docked, its rows show their phase, owner and age once the side is wide enough to hold them. */
function WorkList({
  items,
  read,
  error,
  currentId,
  navigate,
  full,
}: {
  items: WorkRow[];
  read: boolean;
  error: unknown;
  currentId: string;
  navigate: Navigate;
  full?: boolean;
}) {
  const { agents } = useScout();
  const harnessOf = useMemo(() => {
    const byId = new Map(agents.map((agent) => [agent.id, agent.harness] as const));
    return (agentId: string) => byId.get(agentId);
  }, [agents]);
  if (!read) return <p className="wp-quiet">{error ? "Couldn't read work." : "Reading work…"}</p>;
  if (items.length === 0) return <p className="wp-quiet">No tracked work.</p>;
  return (
    <ul className="wp-list" data-full={full || undefined}>
      {items.map((item) => {
        const mark = workRowMark(item);
        return (
          <li key={item.id}>
            <button
              type="button"
              className="wp-row"
              aria-current={item.id === currentId ? "page" : undefined}
              data-done={item.state === "done" || undefined}
              onClick={() => navigate(workRoute(item.id))}
              title={item.title}
            >
              <span className="wp-row-line">
                <span className="wp-row-title">{item.title}</span>
                {mark && <span className="wp-row-dot" aria-label={mark} title={mark} />}
              </span>
              <span className="wp-row-meta">
                <span className={mark ? "wp-mark" : undefined}>{mark ?? item.currentPhase}</span>
                <span>{workOwnerLabel(item, harnessOf)}</span>
                <span className="wp-num">{timeAgo(item.lastMeaningfulAt)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function useDetailTab(workId: string) {
  const { detail } = useWorkDetail(workId);
  const [picked, setPicked] = useState<WorkTab | null>(null);
  // a new work item opens on the tab its state calls for, until one is picked
  useEffect(() => setPicked(null), [workId]);
  return { detail, tab: picked ?? defaultWorkTab(detail), tabs: workDetailTabs(detail), pick: setPicked };
}

function DetailTabs({ tab, tabs, pick }: ReturnType<typeof useDetailTab>) {
  return (
    <div className="wp-tabs" role="tablist" aria-label="Work detail">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`wp-tab-${t.id}`}
          aria-selected={t.id === tab}
          aria-controls="wp-tabpanel"
          className="wp-tab"
          onClick={() => pick(t.id)}
        >
          <TabGlyph tab={t.id} />
          {t.label}
          {t.count !== null && <span className="wp-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** The detail under its title bar: the tabs, then the picked tab. */
function DetailContent({ state, route, navigate }: { state: ReturnType<typeof useDetailTab>; route: Route; navigate: Navigate }) {
  return (
    <div className="wp-detail">
      <DetailTabs {...state} />
      <DetailBody tab={state.tab} route={route} navigate={navigate} />
    </div>
  );
}

/** The work item's head: what it is, where it stands, and the run's ways in. */
function itemHead(detail: WorkDetail | null, navigate: Navigate): { title: ReactNode; right?: ReactNode } {
  const state = detail?.state ? STATE_WORDS[detail.state] ?? detail.state : undefined;
  return {
    title: (
      <>
        <span className="wp-item-mark" aria-hidden="true" />
        <HeadTitle text="Work item" count={state} />
      </>
    ),
    right: detail ? <WorkRunActions detail={detail} navigate={navigate} compact /> : undefined,
  };
}

function ArrangementSwitch({ arrangement, onArrange }: { arrangement: WorkArrangement; onArrange: (next: WorkArrangement) => void }) {
  return (
    <span className="wp-switch" role="group" aria-label="Detail layout">
      <button type="button" aria-pressed={arrangement === "side"} onClick={() => onArrange("side")} title="Detail beside the work item">
        <SideGlyph />
      </button>
      <button type="button" aria-pressed={arrangement === "below"} onClick={() => onArrange("below")} title="Detail under the work item, full width">
        <BelowGlyph />
      </button>
    </span>
  );
}

function DetailBody({ tab, route, navigate }: { tab: WorkTab; route: Route; navigate: Navigate }) {
  return (
    <div className="wp-tabpanel" id="wp-tabpanel" role="tabpanel" aria-labelledby={`wp-tab-${tab}`} data-tab={tab}>
      {tab === "flight" && (
        <div className="wp-flight">
          <Part module={workFlightsModule} route={route} navigate={navigate} id="work-flights" />
          <div className="vw-work-sub">Participants</div>
          <Part module={workPeopleModule} route={route} navigate={navigate} id="work-people" />
        </div>
      )}
      {tab === "timeline" && <Part module={workTimelineModule} route={route} navigate={navigate} id="work-timeline" />}
      {tab === "tail" && <Part module={workTailModule} route={route} navigate={navigate} id="work-tail" />}
      {tab === "files" && <Part module={workFilesModule} route={route} navigate={navigate} id="work-files" />}
    </div>
  );
}

/** A panel drawn like the views' own (hud-grid-panel), for the parts that sit in the main area. */
function Panel({ className, style, bodyStyle, head, children }: { className: string; style?: CSSProperties; bodyStyle?: CSSProperties; head?: { title: ReactNode; right?: ReactNode }; children: ReactNode }) {
  return (
    <section className={`hud-grid-panel ${className}`} style={style}>
      {head && (
        <header className="hud-grid-head">
          <span className="hud-grid-title">{head.title}</span>
          {head.right != null && <span className="hud-grid-right">{head.right}</span>}
        </header>
      )}
      <div className="hud-grid-body" style={bodyStyle}>{children}</div>
    </section>
  );
}

/** Below: the seam between the item and the detail, dragged or moved with the arrow keys; the split is remembered. */
function useBelowSplit() {
  const [share, setShare] = useState(() => parseBelowShare(typeof window === "undefined" ? null : readPref(BELOW_SHARE_KEY)));
  const mainRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ y: number; share: number; height: number } | null>(null);
  const commit = (next: number) => {
    setShare(next);
    writePref(BELOW_SHARE_KEY, String(next));
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !mainRef.current) return;
    event.preventDefault();
    drag.current = { y: event.clientY, share, height: mainRef.current.getBoundingClientRect().height };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer already ended */ }
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    setShare(belowShareAfterDrag(current.share, current.height, event.clientY - current.y));
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    writePref(BELOW_SHARE_KEY, String(share));
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const height = mainRef.current?.getBoundingClientRect().height ?? 0;
    const step = event.shiftKey ? 64 : 16;
    if (event.key === "ArrowUp") commit(belowShareAfterDrag(share, height, -step));
    else if (event.key === "ArrowDown") commit(belowShareAfterDrag(share, height, step));
    else if (event.key === "Home" || event.key === "Enter") commit(BELOW_SHARE_DEFAULT);
    else return;
    event.preventDefault();
  };
  return { share, mainRef, seam: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onKeyDown } };
}

export function WorkPage({ route, navigate }: { route: Extract<Route, { view: "work" }>; navigate: Navigate }) {
  const workId = route.workId;
  const boardReview = isBoardReviewWorkId(workId) && hostFleet.focused().id === LOCAL_HOST_ID;
  const [arrangement, setArrangement] = usePref<WorkArrangement>(ARRANGEMENT_KEY, "side", ["side", "below"]);
  const list = useWorkRows(route);
  const detail = useDetailTab(workId);
  const below = useBelowSplit();
  const [countEl, setCountEl] = useState<HTMLElement | null>(null);

  // with nothing picked, the list is the page: nothing is docked
  const sidesView = useMemo(() => workSides(!!workId, !!workId && arrangement === "side"), [workId, arrangement]);
  const docked = useDockedSides(sidesView);

  const listPanel: DockedPanel = {
    id: "work-list",
    label: "Work",
    title: <HeadTitle text="Work" count={list.items.length > 0 ? list.items.length : undefined} countRef={setCountEl} />,
    className: "wp-list-panel",
    weight: 1,
    countEl,
    children: <WorkList items={list.items} read={list.read} error={list.error} currentId={workId} navigate={navigate} />,
  };
  const detailPanel: DockedPanel = {
    id: "work-detail",
    label: "Detail",
    title: <HeadTitle text="Detail" />,
    right: <ArrangementSwitch arrangement={arrangement} onArrange={setArrangement} />,
    className: "wp-detail-panel",
    weight: 1,
    countEl: null,
    children: <DetailContent state={detail} route={route} navigate={navigate} />,
  };

  const side = (which: ViewSide, panel: DockedPanel) =>
    docked.has[which] && (
      <DockedSide
        side={which}
        panels={[panel]}
        open={docked.isOpen(which)}
        width={docked.widthOf(which)}
        maxWidth={docked.maxOf(which)}
        overlay={!docked.wide}
        onOpen={(open) => docked.setOpen(which, open)}
        onWidth={(width) => docked.setWidth(which, width)}
      />
    );

  return (
    <div className="vw wp" data-arrangement={arrangement}>
      <div className="vw-body vw-body--docked wp-body" ref={docked.bodyRef}>
        {side("left", listPanel)}
        {workId ? (
          <div className="wp-main" ref={below.mainRef}>
            <Panel className="wp-item-panel" style={arrangement === "below" ? { flexGrow: below.share } : undefined} head={itemHead(detail.detail, navigate)}
              bodyStyle={boardReview ? { display: "flex", flexDirection: "column" } : undefined}>
              {boardReview ? <BoardReviewTicket key={workId} workId={workId} /> : null}
              <Part module={workItemModule} route={route} navigate={navigate} id="work-item" />
            </Panel>
            {arrangement === "below" && (
              <>
                <div
                  className="vw-side-split wp-seam"
                  role="separator"
                  tabIndex={0}
                  aria-orientation="horizontal"
                  aria-label="Resize the work item and its detail"
                  title="Drag to resize"
                  {...below.seam}
                />
                <Panel
                  className="wp-detail-panel"
                  style={{ flexGrow: 1 - below.share }}
                  head={{ title: <HeadTitle text="Detail" />, right: <ArrangementSwitch arrangement={arrangement} onArrange={setArrangement} /> }}
                >
                  <DetailContent state={detail} route={route} navigate={navigate} />
                </Panel>
              </>
            )}
          </div>
        ) : (
          <div className="wp-main">
            <Panel className="wp-list-panel wp-list-page" head={{ title: <HeadTitle text="Work" count={list.items.length > 0 ? list.items.length : undefined} /> }}>
              <WorkList items={list.items} read={list.read} error={list.error} currentId="" navigate={navigate} full />
            </Panel>
          </div>
        )}
        {side("right", detailPanel)}
      </div>
    </div>
  );
}
