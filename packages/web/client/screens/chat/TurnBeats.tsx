import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bot, ChevronRight, FilePen, FilePlus2, FileText, FlaskConical, FolderTree, Globe, Info, ListChecks,
  MessageSquareText, Search, Sparkle, SquareTerminal, Wrench, X, type LucideIcon,
} from "lucide-react";
import { MessageMarkup } from "../../lib/message-markup.tsx";
import {
  artifactOpenFailure,
  beatSummary,
  formatClock,
  formatSeconds,
  stepVerb,
  type StepFamily,
  type TurnArtifact,
  type TurnBeat,
  type TurnBeatsView,
  type TurnStepRow,
  type TurnTestRun,
} from "./turn-beats.ts";
import "./turn-beats.css";

/* The study's direction A, on live observe events. The agent's lines lead;
   its calls sit under each line as quiet rows that read left to right: the
   kind, the verb, the file or command, then what it changed and how long it
   took. White marks what is working, coral a failure, green what was added. */

const ICON: Record<StepFamily, LucideIcon> = {
  think: Sparkle, search: Search, fetch: Globe, read: FileText, list: FolderTree, edit: FilePen, write: FilePlus2,
  run: SquareTerminal, check: SquareTerminal, test: SquareTerminal, agent: Bot, plan: ListChecks, ask: MessageSquareText,
  note: Info, other: Wrench,
};

/** Each kind of call keeps one shape, so a run of them reads at a glance. */
function Glyph({ family, state, size = 13 }: { family: StepFamily; state: TurnStepRow["state"]; size?: number }) {
  const Icon = ICON[family];
  return <Icon size={size} strokeWidth={1.5} className="s-tb-glyph" data-state={state} aria-hidden="true" />;
}

export function Diffstat({ add, del }: { add: number; del: number }) {
  return <span className="s-tb-diffstat"><span className="s-tb-add">+{add}</span>{del > 0 && <span className="s-tb-del">−{del}</span>}</span>;
}

const FAIL_LINE = /^\s*\(fail\)|^\s*[1-9]\d* fail(?:ed|ing)?\b|^\s*(?:FAIL|FAILED)\b|^\s*error\b|^\s*[✕×✗]\s/i;

function DiffLine({ line }: { line: string }) {
  const sign = line.startsWith("@@") ? "hunk" : line[0] === "+" ? "add" : line[0] === "-" ? "del" : undefined;
  return <span className="s-tb-dl" data-sign={sign}>
    <i aria-hidden="true">{sign === "add" ? "+" : sign === "del" ? "−" : ""}</i>
    {sign === "add" || sign === "del" ? line.slice(1) : line}
  </span>;
}

function DiffLines({ lines }: { lines: string[] }) {
  return <div className="s-tb-diff">{lines.map((line, index) => <DiffLine key={index} line={line} />)}</div>;
}

function OutLines({ lines, command }: { lines: string[]; command?: string }) {
  return <div className="s-tb-out">
    {command && <span className="s-tb-out-cmd">$ {command}</span>}
    {lines.map((line, index) => <span key={index} data-tone={FAIL_LINE.test(line) ? "fail" : undefined}>{line}</span>)}
  </div>;
}

/** A search hit reads as file:line, then the matched text; the directory is in the hit's title. */
function Hits({ lines }: { lines: string[] }) {
  return <div className="s-tb-out" data-hits="">
    {lines.map((line, index) => {
      const hit = line.match(/^(?:.*\/)?([^/:\s]+:\d+):(.*)$/);
      return <span key={index} className="s-tb-hit" title={line}>
        <span className="s-tb-hit-loc">{hit ? hit[1] : ""}</span>{hit ? hit[2]!.trim() : line}
      </span>;
    })}
  </div>;
}

function StepBody({ step }: { step: TurnStepRow }) {
  if (step.family === "think") return step.text ? <p className="s-tb-think">{step.text}</p> : null;
  if (step.family === "note") return <p className="s-tb-think">{step.title}</p>;
  if (step.diff?.lines.length) return <DiffLines lines={step.diff.lines} />;
  if (!step.output.length) return null;
  if (step.family === "search") return <Hits lines={step.output} />;
  return <OutLines lines={step.output} />;
}

function hasBody(step: TurnStepRow): boolean {
  if (step.family === "think") return Boolean(step.text);
  if (step.family === "note") return step.title.trim() !== step.target.trim();
  return Boolean(step.diff?.lines.length || step.output.length);
}

/** How long a call took: a running clock past two seconds, a measured length past two seconds. */
function tookLabel(step: TurnStepRow, nowMs: number | undefined): string {
  if (step.state === "live") {
    if (step.atMs == null || nowMs == null) return "";
    const seconds = (nowMs - step.atMs) / 1000;
    return seconds >= 2 ? formatClock(seconds) : "";
  }
  if (step.family === "think") return "";
  return step.tookS != null && step.tookS >= 2 ? formatSeconds(step.tookS) : "";
}

/** One call, read left to right as a sentence. A failure opens itself until a rerun passes; a click still closes it. */
export function TurnStepLine({ step, nowMs }: { step: TurnStepRow; nowMs?: number }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const body = hasBody(step);
  const live = step.state === "live";
  const shown = open ?? (step.state === "fail" && !step.recovered);
  const took = tookLabel(step, nowMs);
  const verb = step.family === "think" && !live && step.tookS != null && step.tookS >= 1 ? `Thought for ${formatSeconds(step.tookS)}` : stepVerb(step);
  return <li className="s-tb-step" data-state={step.state} data-family={step.family} data-recovered={step.recovered ? "" : undefined}>
    <button type="button" className="s-tb-row" onClick={() => body && setOpen(!shown)} aria-expanded={body ? shown : undefined} disabled={!body} title={step.title || undefined}>
      <Glyph family={step.family} state={step.state} />
      {verb && <span className="s-tb-verb" data-live={live ? "" : undefined}>{verb}</span>}
      {step.target && <span className="s-tb-target">{step.target}</span>}
      {step.diff && !live && (step.diff.add > 0 || step.diff.del > 0) && <Diffstat add={step.diff.add} del={step.diff.del} />}
      {took && <span className="s-tb-took">{took}</span>}
      {body && !live && <ChevronRight size={12} className="s-tb-chev" data-open={shown ? "" : undefined} aria-hidden="true" />}
    </button>
    {live && step.output.length > 0 && <div className="s-tb-tail">{step.output.at(-1)}<i className="s-tb-caret" /></div>}
    {shown && !live && <StepBody step={step} />}
  </li>;
}

function Say({ text, now = false, caret = false }: { text: string; now?: boolean; caret?: boolean }) {
  return <div className="s-tb-say" data-now={now ? "" : undefined}>
    <MessageMarkup text={text} />
    {caret && <i className="s-tb-caret" />}
  </div>;
}

/** The live beat shows its newest calls; the earlier ones wait behind a count. */
const LIVE_BEAT_ROWS = 6;

/** One glyph for each kind of call in a folded beat, in first-seen order; a kind turns coral when one of its calls still fails. */
function clusterOf(steps: TurnStepRow[]): { family: StepFamily; fail: boolean }[] {
  const kinds = new Map<StepFamily, boolean>();
  for (const step of steps) kinds.set(step.family, (kinds.get(step.family) ?? false) || (step.state === "fail" && !step.recovered));
  return [...kinds].slice(0, 4).map(([family, fail]) => ({ family, fail }));
}

function BeatBlock({ beat, current, writing, expanded, nowMs }: { beat: TurnBeat; current: boolean; writing: boolean; expanded: boolean; nowMs?: number }) {
  // Your toggle wins over every rule that opens or folds a beat by itself.
  const [open, setOpen] = useState<boolean | null>(null);
  const [all, setAll] = useState(false);
  const summary = beatSummary(beat);
  // Thinking alone is already one line; it needs no summary over it.
  const thinkOnly = beat.steps.every((step) => step.family === "think");
  const isOpen = current || thinkOnly || (open ?? (expanded || summary.failed));
  const calls = beat.steps.filter((step) => step.family !== "think");
  const hidden = current && !all ? Math.max(0, beat.steps.length - LIVE_BEAT_ROWS) : 0;
  const rows = hidden > 0 ? beat.steps.slice(-LIVE_BEAT_ROWS) : beat.steps;
  return <li className="s-tb-beat" data-current={current ? "" : undefined}>
    {beat.say && <Say text={beat.say.text} now={current} caret={writing && beat.steps.length === 0} />}
    {beat.steps.length > 0 && !current && !thinkOnly && (
      <button type="button" className="s-tb-fold" onClick={() => setOpen(!isOpen)} aria-expanded={isOpen} data-failed={summary.failed ? "" : undefined}>
        <span className="s-tb-cluster">
          {clusterOf(calls).map(({ family, fail }) => <Glyph key={family} family={family} state={fail ? "fail" : "ok"} size={12} />)}
        </span>
        <span>{summary.text}</span>
        {summary.add + summary.del > 0 && <Diffstat add={summary.add} del={summary.del} />}
        <ChevronRight size={12} className="s-tb-fold-chev" data-open={isOpen ? "" : undefined} aria-hidden="true" />
      </button>
    )}
    {beat.steps.length > 0 && isOpen && <ol className="s-tb-steps">
      {hidden > 0 && <li><button type="button" className="s-tb-more" onClick={() => setAll(true)}>{hidden} earlier {hidden === 1 ? "call" : "calls"}</button></li>}
      {rows.map((step) => <TurnStepLine key={step.id} step={step} nowMs={nowMs} />)}
    </ol>}
    {writing && beat.steps.length > 0 && <div className="s-tb-writing"><i className="s-tb-caret" /></div>}
  </li>;
}

/**
 * Every beat. A past beat folds to the shapes of its calls and a count, and a
 * beat with a failure no rerun passed stays open. `expanded` opens them all.
 */
export function TurnBeatList({ view, running = false, expanded = false, nowMs }: { view: TurnBeatsView; running?: boolean; expanded?: boolean; nowMs?: number }) {
  return <ol className="s-tb s-tb-beats">
    {view.beats.map((beat, index) => {
      const current = running && index === view.beats.length - 1;
      return <BeatBlock key={beat.id} beat={beat} current={current} writing={current && !view.live} expanded={expanded} nowMs={nowMs} />;
    })}
  </ol>;
}

/** Concise, while the turn runs: the newest line, any failure still open, and the call it is on. */
export function TurnNow({ view, nowMs }: { view: TurnBeatsView; nowMs?: number }) {
  const open = view.steps.filter((step) => step.state === "fail" && !step.recovered);
  const current = view.live ?? (view.beats.at(-1)?.steps.at(-1) ?? null);
  const rows = current && !open.includes(current) ? [...open, current] : open;
  return <div className="s-tb s-tb-now">
    {view.lastSay && <Say text={view.lastSay.text} now caret={!view.live && !current} />}
    {rows.length > 0 && <ol className="s-tb-steps">{rows.map((step) => <TurnStepLine key={step.id} step={step} nowMs={nowMs} />)}</ol>}
  </div>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The finished turn's one line: how long, how many calls, what changed, and any failure. */
export function TurnDoneLine({ lead, state, view, lastCall }: {
  lead: string;
  state: "working" | "worked" | "stopped";
  view: TurnBeatsView | null;
  lastCall?: string | null;
}) {
  return <span className="s-tb-done" data-state={state}>
    <span className="s-tb-done-lead">{lead}</span>
    {view && view.calls > 0 && <span>{plural(view.calls, "call")}</span>}
    {view && view.files.length > 0 && <span className="s-tb-done-files">
      {plural(view.files.length, "file")}{(view.add > 0 || view.del > 0) && <Diffstat add={view.add} del={view.del} />}
    </span>}
    {view && (view.unrecovered > 0
      ? <span className="s-tb-fail-text">{view.unrecovered} failed</span>
      : view.failed > 0 && <span>{view.failed} failed, rerun passed</span>)}
    {lastCall && <span className="s-tb-done-last" title={lastCall}>Last call: {lastCall}</span>}
    <ChevronRight size={12} className="s-tb-fold-chev s-tb-done-chev" aria-hidden="true" />
  </span>;
}

/* ── what the turn made, drawn for its kind ───────────────────────────── */

function wallClock(atMs: number | null): string {
  if (atMs == null) return "";
  return new Date(atMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type Head = { Icon: LucideIcon; kind: string; title: string; path: string; stat: ReactNode; foot: string; tone?: "pass" | "fail" };

function runVerdict(run: TurnTestRun): string {
  if (run.fail != null && run.fail > 0) return `${run.fail} failing`;
  if (run.pass != null) return `${run.pass} pass`;
  return run.step.state === "fail" ? "failed" : run.step.outcome === "success" ? "passed" : "ran";
}

function headOf(artifact: TurnArtifact): Head {
  if (artifact.kind === "diff") {
    const { file } = artifact;
    const last = wallClock(file.edits.at(-1)?.atMs ?? null);
    return {
      Icon: file.edits.every((edit) => edit.family === "write") ? FilePlus2 : FilePen,
      kind: "Change",
      title: file.name,
      path: file.path,
      stat: file.counted ? <Diffstat add={file.add} del={file.del} /> : null,
      foot: file.edits.length === 1 ? (last ? `Edited at ${last}` : "Edited once") : `Edited ${file.edits.length} times${last ? ` · last ${last}` : ""}`,
    };
  }
  if (artifact.kind === "tests") {
    const last = artifact.runs.at(-1)!;
    const failedRuns = artifact.runs.filter((run) => run.step.state === "fail").length;
    return {
      Icon: FlaskConical,
      kind: "Tests",
      title: artifact.name,
      path: artifact.command,
      stat: runVerdict(last),
      foot: artifact.runs.length > 1 && failedRuns ? `${plural(artifact.runs.length, "run")} · ${failedRuns} failed` : plural(artifact.runs.length, "run"),
      tone: last.step.state === "fail" ? "fail" : last.pass != null || last.step.outcome === "success" ? "pass" : undefined,
    };
  }
  const last = artifact.runs.at(-1)!;
  const failedRuns = artifact.runs.filter((run) => run.state === "fail").length;
  const at = wallClock(last.atMs);
  return {
    Icon: SquareTerminal,
    kind: "Check",
    title: artifact.name,
    path: artifact.command,
    stat: last.state === "fail" ? "failed" : last.outcome === "success" ? "passed" : last.tookS != null && last.tookS >= 1 ? formatSeconds(last.tookS) : "ran",
    foot: artifact.runs.length > 1 ? `${plural(artifact.runs.length, "run")}${failedRuns ? ` · ${failedRuns} failed` : ""}` : at ? `Ran at ${at}` : "Ran once",
    tone: last.state === "fail" ? "fail" : last.outcome === "success" ? "pass" : undefined,
  };
}

/** One cell per test while a suite is small enough to count by eye; a measured bar past that. */
const CELL_LIMIT = 48;

function Cells({ run, label }: { run: TurnTestRun; label?: string }) {
  if (run.pass == null || run.fail == null) return null;
  const total = run.pass + run.fail;
  if (total === 0) return null;
  return <span className="s-tb-run">
    {label && <span className="s-tb-run-label">{label}</span>}
    {total <= CELL_LIMIT
      ? <span className="s-tb-cells" aria-label={`${run.pass} of ${total} passed`}>
          {Array.from({ length: total }, (_, index) => <i key={index} data-s={index < run.pass! ? "pass" : "fail"} />)}
        </span>
      : <span className="s-tb-meter" aria-label={`${run.pass} of ${total} passed`}>
          <i data-s="pass" style={{ flexGrow: run.pass }} />
          {run.fail > 0 && <i data-s="fail" style={{ flexGrow: Math.max(run.fail, total / 60) }} />}
        </span>}
  </span>;
}

/** A file's folder as a card shows it: the last three folders, home as ~. */
function folderOf(path: string): string {
  const parts = path.replace(/^\/Users\/[^/]+/, "~").split("/").slice(0, -1);
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : parts.join("/") || ".";
}

/** The small render on a card: a few lines of the diff, the cells per run, the check's last lines. */
function Mini({ artifact }: { artifact: TurnArtifact }) {
  if (artifact.kind === "diff") {
    const lines = artifact.file.edits.flatMap((edit) => edit.diff?.lines ?? []).filter((line) => !line.startsWith("@@"));
    // Some harnesses report which file changed but not the lines: show where it lives.
    return lines.length
      ? <span className="s-tb-mini-diff">{lines.slice(0, 4).map((line, index) => <DiffLine key={index} line={line} />)}</span>
      : <span className="s-tb-mini-out"><span>{folderOf(artifact.file.path)}</span></span>;
  }
  if (artifact.kind === "tests" && artifact.runs.some((run) => run.pass != null)) {
    return <span className="s-tb-runs">{artifact.runs.slice(-3).map((run, index, shown) => <Cells key={run.step.id} run={run} label={shown.length > 1 ? `run ${artifact.runs.length - shown.length + index + 1}` : undefined} />)}</span>;
  }
  const step = artifact.kind === "tests" ? artifact.runs.at(-1)!.step : artifact.kind === "check" ? artifact.runs.at(-1)! : null;
  return <span className="s-tb-mini-out">{(step?.output ?? []).slice(-3).map((line, index) => <span key={index}>{line}</span>)}</span>;
}

/** The whole render: every edit's lines in order, every run with what failed, the check's output. */
function ArtifactFull({ artifact }: { artifact: TurnArtifact }) {
  if (artifact.kind === "diff" && !artifact.file.edits.some((edit) => edit.diff?.lines.length)) {
    return <>
      <ol className="s-tb-edit-times">
        {artifact.file.edits.map((edit) => <li key={edit.id}>{edit.family === "write" ? "Wrote" : "Edited"}{edit.atMs != null ? ` at ${wallClock(edit.atMs)}` : ""}</li>)}
      </ol>
      <p className="s-tb-fine">This session's feed names the file it changed, not the lines.</p>
    </>;
  }
  if (artifact.kind === "diff") {
    return <>
      {artifact.file.edits.map((edit) => <section key={edit.id} className="s-tb-hunk">
        <header className="s-tb-hunk-head">
          <span>{edit.family === "write" ? "Wrote" : "Edit"}{edit.atMs != null ? ` at ${wallClock(edit.atMs)}` : ""}</span>
          {edit.diff && artifact.file.counted && <Diffstat add={edit.diff.add} del={edit.diff.del} />}
        </header>
        {edit.diff?.lines.length ? <DiffLines lines={edit.diff.lines} /> : <p className="s-tb-fine">No lines for this edit.</p>}
      </section>)}
      <p className="s-tb-fine">The feed carries a preview of each edit, not the whole file.</p>
    </>;
  }
  if (artifact.kind === "tests") {
    return <>
      {artifact.runs.map((run, index) => <section key={run.step.id} className="s-tb-test-run" data-s={run.step.state === "fail" ? "fail" : "pass"}>
        <header className="s-tb-hunk-head">
          <span>Run {index + 1}{run.step.atMs != null ? ` · ${wallClock(run.step.atMs)}` : ""}{run.step.tookS != null && run.step.tookS >= 1 ? ` · ${formatSeconds(run.step.tookS)}` : ""}</span>
          <span className="s-tb-run-verdict">{runVerdict(run)}</span>
        </header>
        <Cells run={run} />
        {run.failing.length > 0 && <ul className="s-tb-failing">{run.failing.map((name) => <li key={name}>{name}</li>)}</ul>}
        {run.step.output.length > 0 && <OutLines lines={run.step.output} />}
      </section>)}
    </>;
  }
  return <>
    {artifact.runs.map((run, index) => <section key={run.id} className="s-tb-test-run" data-s={run.state === "fail" ? "fail" : "pass"}>
      {artifact.runs.length > 1 && <header className="s-tb-hunk-head">
        <span>Run {index + 1}{run.atMs != null ? ` · ${wallClock(run.atMs)}` : ""}</span>
        <span className="s-tb-run-verdict">{run.state === "fail" ? "failed" : run.outcome === "success" ? "passed" : ""}</span>
      </header>}
      <OutLines command={run.title} lines={run.output.length ? run.output : ["No output reached the feed."]} />
    </section>)}
  </>;
}

/** How many cards or chips the tray draws before "N more". */
const TRAY_CARDS = 6;
const TRAY_CHIPS = 8;

/**
 * Brings an opened panel into its scroller's view by the least distance,
 * keeping its top in view. Only the nearest scroller moves: scrollIntoView
 * would also move outer frames, such as the host app's web view. The
 * scroller's scroll-padding marks what floats over it, like the composer.
 */
function reveal(panel: HTMLElement): void {
  let scroller = panel.parentElement;
  while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  if (!scroller) return;
  const style = getComputedStyle(scroller);
  const frame = scroller.getBoundingClientRect();
  const box = panel.getBoundingClientRect();
  const below = box.bottom - (frame.bottom - (parseFloat(style.scrollPaddingBottom) || 0));
  const room = box.top - (frame.top + (parseFloat(style.scrollPaddingTop) || 0));
  const by = Math.min(below, room);
  if (by <= 0) return;
  const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  scroller.scrollBy({ top: by, behavior: still ? "auto" : "smooth" });
}

/**
 * What the turn made, under its answer. Detailed draws cards; concise draws
 * chips. A card opens its full render in place, below the tray, so it works
 * in a narrow drawer as well as on the full page.
 */
export function TurnArtifacts({ artifacts, compact = false }: { artifacts: TurnArtifact[]; compact?: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (openId && panelRef.current) reveal(panelRef.current);
  }, [openId]);
  if (artifacts.length === 0) return null;
  const opened = artifacts.find((artifact) => artifact.id === openId) ?? null;
  const toggle = (id: string) => setOpenId(openId === id ? null : id);
  const head = opened ? headOf(opened) : null;
  // A long turn makes many things; the tray leads with what matters and keeps the rest one click away.
  const limit = compact ? TRAY_CHIPS : TRAY_CARDS;
  const shown = all || artifacts.length <= limit + 1 ? artifacts : artifacts.slice(0, limit);
  const rest = artifacts.length - shown.length;
  const more = rest > 0 && <button type="button" className="s-tb-tray-more" onClick={() => setAll(true)}>{rest} more</button>;
  return <section className="s-tb s-tb-tray" aria-label="From this turn">
    {compact
      ? <div className="s-tb-chips">
          {shown.map((artifact) => {
            const item = headOf(artifact);
            return <button key={artifact.id} type="button" className="s-tb-chip" data-tone={item.tone} aria-pressed={openId === artifact.id} onClick={() => toggle(artifact.id)} title={item.path}>
              <item.Icon size={11} strokeWidth={1.5} aria-hidden="true" />
              <span className="s-tb-chip-name">{item.title}</span>
              {item.stat != null && <span className="s-tb-chip-stat">{item.stat}</span>}
            </button>;
          })}
          {more}
        </div>
      : <>
          <header className="s-tb-tray-head"><span className="s-tb-label">From this turn</span><span>{artifacts.length}</span>{more}</header>
          <div className="s-tb-cards">
            {shown.map((artifact) => {
              const item = headOf(artifact);
              return <button key={artifact.id} type="button" className="s-tb-card" data-tone={item.tone} data-open-failure={artifactOpenFailure(artifact) ? "" : undefined} aria-pressed={openId === artifact.id} onClick={() => toggle(artifact.id)} title={item.path}>
                <span className="s-tb-card-head">
                  <item.Icon size={12} strokeWidth={1.5} aria-hidden="true" />
                  <span className="s-tb-card-name">{item.title}</span>
                  <span className="s-tb-card-stat">{item.stat}</span>
                </span>
                <span className="s-tb-card-body"><Mini artifact={artifact} /></span>
                <span className="s-tb-card-foot">{item.foot}</span>
              </button>;
            })}
          </div>
        </>}
    {opened && head && <div ref={panelRef} className="s-tb-open" role="region" aria-label={`${head.kind}: ${head.title}`}>
      <header className="s-tb-open-head">
        <span className="s-tb-label">{head.kind}</span>
        <span className="s-tb-open-title">{head.title}</span>
        <span className="s-tb-open-stat" data-tone={head.tone}>{head.stat}</span>
        <button type="button" className="s-tb-open-close" onClick={() => setOpenId(null)} aria-label="Close"><X size={13} /></button>
      </header>
      <p className="s-tb-open-path" title={head.path}>{head.path}</p>
      <div className="s-tb-open-body"><ArtifactFull artifact={opened} /></div>
    </div>}
  </section>;
}
