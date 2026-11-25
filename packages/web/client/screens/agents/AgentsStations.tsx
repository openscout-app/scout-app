import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import "./agents-stations.css";
import { api } from "../../lib/api.ts";
import { timeAgo } from "../../lib/time.ts";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { projectHue } from "../../components/ProjectMark.tsx";
import { useWorkGlance, useWorkList } from "../work/use-work-detail.ts";
import type { Agent, FleetState, Route, WorkItem, WorkMaterialContent } from "../../lib/types.ts";
import {
  buildStations,
  carryItems,
  opening,
  stationSurface,
  stationWorkIds,
  type Station,
  type StationFile,
  type StationKind,
  type StationSurface,
} from "./agents-stations-model.ts";

/* ──────────────────────────────────────────────────────────────────────────
   Agents · Stations — the work in progress above the feed. One card per
   piece of work, with everyone working on it and a surface that fits what
   they are making: the conversation, the files under change, the page being
   written, or the frames being rendered. From the studio study
   design/studio/views/milestone-feed.tsx (Stations). When the last ask ends
   the card leaves, and what it made arrives in the feed below as a post.
   ────────────────────────────────────────────────────────────────────────── */

const KIND_LABEL: Record<StationKind, string> = {
  talk: "Talk",
  code: "Code",
  writing: "Writing",
  visual: "Visual",
};
const FIRST_READ_WAIT_MS = 1_500;

export function AgentsStations({
  fleet,
  agents,
  navigate,
  agentId = null,
}: {
  fleet: FleetState | null;
  agents: Agent[];
  navigate: (route: Route) => void;
  agentId?: string | null;
}) {
  const ids = stationWorkIds(fleet);
  const list = useWorkList(ids.length ? `/api/work?ids=${ids.map(encodeURIComponent).join(",")}` : "");
  // Any ask starting or ending changes the ids= path, and a new path starts
  // empty. The items already read carry over, so grouped stations do not
  // split (and remount) while the new read is out.
  const known = useRef(new Map<string, WorkItem>());
  const workItems = useMemo(
    () => carryItems(known.current, list.value, ids),
    [ids.join(","), list.value], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const seen = useRef(new Map<string, number>());
  const stations = useMemo(
    () => buildStations({ fleet, agents, workItems, agentId, seen: seen.current }),
    [agentId, agents, fleet, workItems],
  );
  // The first read decides which asks share a station; drawing before it
  // lands would draw each ask alone, then merge them.
  // Not for long: on a slow host that read can take many seconds.
  const [patient, setPatient] = useState(true);
  useEffect(() => {
    const handle = setTimeout(() => setPatient(false), FIRST_READ_WAIT_MS);
    return () => clearTimeout(handle);
  }, []);
  const settled = !patient || !ids.length || workItems.length > 0 || list.loaded || list.error !== null;
  if (!stations.length || !settled) return null;
  return (
    <section className="ahf-section ast" aria-label="At the stations">
      <h3 className="ahf-label">
        <span className="ast-liveDot" aria-hidden="true" />
        <span>At the stations</span>
      </h3>
      <div className="ast-grid" data-single={stations.length === 1 || undefined}>
        {stations.map((station) => (
          <StationCard key={station.id} station={station} agents={agents} navigate={navigate} />
        ))}
      </div>
    </section>
  );
}

function StationCard({
  station,
  agents,
  navigate,
}: {
  station: Station;
  agents: Agent[];
  navigate: (route: Route) => void;
}) {
  const { detail } = useWorkGlance(station.surfaceWorkId ?? "");
  const surface = useMemo(
    () => stationSurface(detail, station.surfaceWorkId, station.title),
    [detail, station.surfaceWorkId, station.title],
  );
  const conversationId = station.players.find((p) => p.conversationId)?.conversationId ?? null;
  const route: Route | null = station.workId
    ? { view: "work", workId: station.workId }
    : conversationId
      ? { view: "conversation", conversationId }
      : null;
  const hue = station.project ? projectHue(station.project) : null;
  const style = hue === null ? undefined : ({ "--ast-h": hue } as CSSProperties);

  return (
    <article className="ast-station" data-kind={surface.kind} data-hued={hue === null ? undefined : true} style={style}>
      <button type="button" className="ast-head" disabled={!route} onClick={() => route && navigate(route)}>
        <span className="ast-kind">{KIND_LABEL[surface.kind]}</span>
        <span className="ast-title" title={station.title}>{station.title}</span>
        {station.project ? <span className="ast-project">/{station.project}</span> : null}
      </button>

      <ul className="ast-players" aria-label="Working here">
        {station.players.map((player) => (
          <li key={player.id} className="ast-player" data-live={player.live || undefined} data-waiting={player.waiting ? "" : undefined}>
            <span className="ast-coin">
              <AgentAvatar name={player.agent} harness={player.harness ?? undefined} size={24} presence={false} scaleWithPreference={false} />
            </span>
            <span className="ast-who">{player.agent}</span>
            <HarnessMark harness={player.harness ?? "unknown"} size={12} />
            <span className="ast-doing" title={player.task}>{player.live ? player.task : `${player.waiting ?? "Queued"} · ${player.task}`}</span>
          </li>
        ))}
      </ul>

      <div className="ast-surface">
        <Surface surface={surface} station={station} agents={agents} />
      </div>

      <p className="ast-foot">
        <span>Since <time dateTime={new Date(station.since).toISOString()}>{clock(station.since)}</time></span>
        <span className="ast-age">{timeAgo(station.since)}</span>
      </p>
    </article>
  );
}

function Surface({ surface, station, agents }: { surface: StationSurface; station: Station; agents: Agent[] }) {
  const latest = surface.lines[surface.lines.length - 1] ?? null;
  if (surface.kind === "visual") {
    return (
      <>
        <div className="ast-sheet">
          {surface.frames.map((frame) => (
            <figure key={frame.id} className="ast-frame">
              <img src={frame.src} alt={frame.name} loading="lazy" />
              <figcaption title={frame.name}>{frame.name}</figcaption>
            </figure>
          ))}
        </div>
        {latest ? <Line line={latest} agents={agents} compact /> : null}
      </>
    );
  }
  if (surface.kind === "code") {
    return (
      <>
        <Files files={surface.files} station={station} agents={agents} />
        {latest ? <Line line={latest} agents={agents} compact /> : null}
      </>
    );
  }
  if (surface.kind === "writing") {
    return (
      <>
        <Excerpt workId={station.surfaceWorkId} file={surface.files[0] ?? null} />
        <Files files={surface.files} station={station} agents={agents} />
      </>
    );
  }
  // talk: the conversation is the work
  const working = station.players.find((p) => p.live && p.agentId !== latest?.actorId);
  const held = working ? null : station.players.find((p) => p.waiting);
  return (
    <div className="ast-talk">
      {surface.lines.length ? (
        surface.lines.map((line) => <Line key={line.id} line={line} agents={agents} />)
      ) : (
        <p className="ast-brief">{station.players[0]?.task}</p>
      )}
      {working ? (
        <p className="ast-typing">
          {working.agent} is working <span className="ast-dots" aria-hidden="true"><i /><i /><i /></span>
        </p>
      ) : held ? (
        <p className="ast-typing" data-waiting="">{held.agent} · {held.waiting}</p>
      ) : null}
    </div>
  );
}

function Line({ line, agents, compact = false }: { line: StationSurface["lines"][number]; agents: Agent[]; compact?: boolean }) {
  const harness = agents.find((a) => a.id === line.actorId || a.name === line.actor)?.harness ?? undefined;
  return (
    <div className="ast-msg" data-compact={compact || undefined}>
      <AgentAvatar name={line.actor} harness={harness} size={18} presence={false} scaleWithPreference={false} />
      <p><b>{line.actor}</b> {line.text}</p>
    </div>
  );
}

function Files({ files, station, agents }: { files: StationFile[]; station: Station; agents: Agent[] }) {
  return (
    <ul className="ast-files">
      {files.map((file) => {
        const player = station.players.find((p) => p.agentId === file.agentId);
        const agent = player ? null : agents.find((a) => a.id === file.agentId);
        const name = player?.agent ?? agent?.name ?? null;
        return (
          <li key={file.id}>
            <span className="ast-path" title={file.path}>{file.name}</span>
            <span className="ast-fileWho">
              {name ? <AgentAvatar name={name} harness={player?.harness ?? agent?.harness ?? undefined} size={16} presence={false} scaleWithPreference={false} /> : null}
            </span>
            <span className="ast-add">{file.additions ? `+${file.additions}` : ""}</span>
            <span className="ast-del">{file.deletions ? `−${file.deletions}` : ""}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* The page being written: its opening, read once per change to its size. */
function Excerpt({ workId, file }: { workId: string | null; file: StationFile | null }) {
  // the text is kept with the file it came from, so a new file's name never
  // sits over the last file's words while its own read is out
  const [shown, setShown] = useState<{ id: string; text: string } | null>(null);
  const key = workId && file ? `${workId}|${file.id}|${file.additions}|${file.deletions}` : "";
  useEffect(() => {
    if (!key || !workId || !file) return;
    let cancelled = false;
    const id = file.id;
    api<WorkMaterialContent>(`/api/work/${encodeURIComponent(workId)}/material?materialId=${encodeURIComponent(id)}`)
      .then((content) => { if (!cancelled) setShown({ id, text: opening(content.content) }); })
      .catch(() => { if (!cancelled) setShown(null); });
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const text = file && shown?.id === file.id ? shown.text : "";
  if (!file || !text) return null;
  return (
    <div className="ast-page">
      <p className="ast-docName">{file.name}</p>
      <p className="ast-prose">{text}<span className="ast-caret" aria-hidden="true" /></p>
    </div>
  );
}


function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
