import type { ViewModuleSize } from "../views-model.ts";
import { activityModule } from "./activity.tsx";
import { activityItemModule } from "./activity-item.tsx";
import { agentModule } from "./agent.tsx";
import { agentActivityModule } from "./agent-activity.tsx";
import { agentCardModule } from "./agent-card.tsx";
import { agentSessionModule } from "./agent-session.tsx";
import { agentsModule } from "./agents.tsx";
import { agentsDirectoryModule } from "./agents-directory.tsx";
import { agentsRosterModule } from "./agents-roster.tsx";
import { doneModule, inflightModule } from "./asks.tsx";
import { briefingModule } from "./briefing.tsx";
import { briefingsModule } from "./briefings.tsx";
import { cloudAccountsModule } from "./cloud-accounts.tsx";
import type { ViewModuleDef } from "./contract.ts";
import { conversationsModule } from "./conversations.tsx";
import { harnessFamiliesModule } from "./harness-families.tsx";
import { homeCoordModule } from "./home-coord.tsx";
import { homeMessageModule } from "./home-message.tsx";
import { homeMovingModule } from "./home-moving.tsx";
import { homeQuotasModule } from "./home-quotas.tsx";
import { homeRecentModule } from "./home-recent.tsx";
import { homeVelocityModule } from "./home-velocity.tsx";
import { hostReadingModule } from "./host-reading.tsx";
import { hostReadoutsModule } from "./host-readouts.tsx";
import { hostsModule } from "./hosts.tsx";
import { inFlightWorktreesModule } from "./in-flight.tsx";
import { laneModule } from "./lane.tsx";
import { lanesModule } from "./lanes.tsx";
import { lanesRosterModule } from "./lanes-roster.tsx";
import { machineModule } from "./machine.tsx";
import { meshMapModule } from "./mesh-map.tsx";
import { meshOpsModule } from "./mesh-ops.tsx";
import { meshOpsHostsModule } from "./mesh-ops-hosts.tsx";
import { meshOpsItemModule } from "./mesh-ops-item.tsx";
import { meshRackModule } from "./mesh-rack.tsx";
import { missionContextModule } from "./mission-context.tsx";
import { missionRosterModule } from "./mission-roster.tsx";
import { missionWallModule } from "./mission-wall.tsx";
import { opsQueueModule } from "./ops-queue.tsx";
import { opsSummaryModule } from "./ops-summary.tsx";
import { planDocumentModule } from "./plan-document.tsx";
import { projectModule } from "./project.tsx";
import { projectDetailsModule } from "./project-details.tsx";
import { projectAgentsModule } from "./project-agents.tsx";
import { projectSessionsModule } from "./project-sessions.tsx";
import { projectsModule } from "./projects.tsx";
import { providerRoutingModule } from "./provider-routing.tsx";
import { prsModule } from "./prs.tsx";
import { quotasModule } from "./quotas.tsx";
import { repoDiffModule } from "./repo-diff.tsx";
import { repoWorktreeModule } from "./repo-worktree.tsx";
import { reposModule } from "./repos.tsx";
import { requestModule } from "./request.tsx";
import { requestsModule } from "./requests.tsx";
import { runtimeSummaryModule } from "./runtime-summary.tsx";
import { runtimeTableModule } from "./runtime-table.tsx";
import { searchModule } from "./search.tsx";
import { searchHitModule } from "./search-hit.tsx";
import { searchIndexModule } from "./search-index.tsx";
import { searchResultsModule } from "./search-results.tsx";
import { sessionModule } from "./session.tsx";
import { projectBranchesModule, projectDiffModule, projectNavModule, projectThreadModule, sessionChangesModule } from "./project-look.tsx";
import { projectSnapshotModule } from "./project-snapshot.tsx";
import { sessionBoardModule } from "./session-board.tsx";
import { sessionDetailsModule } from "./session-details.tsx";
import { sessionThreadModule } from "./session-thread.tsx";
import { staleModule } from "./stale.tsx";
import { subscriptionsModule } from "./subscriptions.tsx";
import { alertsModule, tailModule } from "./tail.tsx";
import { tailEventModule } from "./tail-event.tsx";
import { tailFollowModule } from "./tail-follow.tsx";
import { terminalModule } from "./terminal.tsx";
import { terminalDetailsModule } from "./terminal-details.tsx";
import { terminalIndexModule } from "./terminal-index.tsx";
import { terminalSessionModule } from "./terminal-session.tsx";
import { terminalWorkspaceModule } from "./terminal-workspace.tsx";
import { thisHostModule } from "./this-host.tsx";
import { voiceCallModule } from "./voice-call.tsx";
import { voiceStageModule } from "./voice-stage.tsx";
import { voiceTurnModule } from "./voice-turn.tsx";
import { voiceTurnsModule } from "./voice-turns.tsx";
import { voiceUsageModule } from "./voice-usage.tsx";
import { workModule } from "./work.tsx";
import { workBoardModule } from "./work-board.tsx";
import { workMovesModule } from "./work-moves.tsx";
import { workFilesModule } from "./work-files.tsx";
import { workFlightsModule } from "./work-flights.tsx";
import { workItemModule } from "./work-item.tsx";
import { workPeopleModule } from "./work-people.tsx";
import { workTailModule } from "./work-tail.tsx";
import { workTimelineModule } from "./work-timeline.tsx";
import { worktreesModule } from "./worktrees.tsx";

/** Every module a view can hold, in library order. Register a new one here once. */
export const VIEW_MODULES: readonly ViewModuleDef[] = [
  terminalModule,
  terminalIndexModule,
  terminalWorkspaceModule,
  terminalSessionModule,
  terminalDetailsModule,
  agentsModule,
  tailModule,
  alertsModule,
  tailEventModule,
  tailFollowModule,
  activityModule,
  activityItemModule,
  briefingsModule,
  briefingModule,
  homeQuotasModule,
  homeVelocityModule,
  homeMovingModule,
  homeCoordModule,
  homeMessageModule,
  homeRecentModule,
  conversationsModule,
  inflightModule,
  doneModule,
  requestsModule,
  requestModule,
  opsQueueModule,
  workModule,
  workBoardModule,
  workMovesModule,
  workItemModule,
  workTimelineModule,
  workPeopleModule,
  workFlightsModule,
  workTailModule,
  workFilesModule,
  projectsModule,
  projectModule,
  projectDetailsModule,
  projectSessionsModule,
  sessionModule,
  projectSnapshotModule,
  projectNavModule,
  projectThreadModule,
  sessionChangesModule,
  projectBranchesModule,
  projectDiffModule,
  sessionBoardModule,
  sessionThreadModule,
  sessionDetailsModule,
  worktreesModule,
  projectAgentsModule,
  agentActivityModule,
  agentModule,
  agentSessionModule,
  agentCardModule,
  prsModule,
  reposModule,
  repoWorktreeModule,
  repoDiffModule,
  hostsModule,
  machineModule,
  meshMapModule,
  meshRackModule,
  meshOpsModule,
  meshOpsItemModule,
  meshOpsHostsModule,
  quotasModule,
  subscriptionsModule,
  providerRoutingModule,
  cloudAccountsModule,
  missionWallModule,
  missionRosterModule,
  missionContextModule,
  opsSummaryModule,
  inFlightWorktreesModule,
  staleModule,
  hostReadoutsModule,
  hostReadingModule,
  thisHostModule,
  planDocumentModule,
  runtimeSummaryModule,
  harnessFamiliesModule,
  runtimeTableModule,
  agentsDirectoryModule,
  agentsRosterModule,
  lanesModule,
  laneModule,
  lanesRosterModule,
  searchModule,
  searchResultsModule,
  searchHitModule,
  searchIndexModule,
  voiceStageModule,
  voiceCallModule,
  voiceTurnsModule,
  voiceTurnModule,
  voiceUsageModule,
];

const BY_TYPE = new Map(VIEW_MODULES.map((m) => [m.type, m]));

export function viewModule(type: string): ViewModuleDef | undefined {
  return BY_TYPE.get(type);
}

export function moduleSize(type: string): ViewModuleSize {
  return BY_TYPE.get(type)?.size ?? { w: 6, h: 8 };
}
