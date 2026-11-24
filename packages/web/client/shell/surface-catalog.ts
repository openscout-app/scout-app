/**
 * The five Scout App surfaces, as data. This module has no React or DOM
 * dependency, so the preview host and other servers can read which paths the
 * shell owns. `surfaces.tsx` attaches the components that exist today.
 */

export type SurfaceId = "feed" | "chat" | "sessions" | "board" | "control";

/** `live` ships in this build. `planned` has a reserved slot and route but no screen yet. */
export type SurfaceStatus = "live" | "planned";

/**
 * What a surface does when its host allows it.
 * - `read`: shows records from the local runtime.
 * - `write`: sends replies, moves or other changes through host-authorized routes.
 * - `live-updates`: follows runtime events instead of polling.
 * - `embed`: mounts chrome-free in a launcher or native WebView.
 */
export type SurfaceCapability = "read" | "write" | "live-updates" | "embed";

export type ScoutSurfaceDescriptor = {
  id: SurfaceId;
  label: string;
  /** The app route. Each surface owns exactly one top-level path. */
  route: `/${string}`;
  status: SurfaceStatus;
  /** One plain sentence: what the surface is for. */
  description: string;
  capabilities: readonly SurfaceCapability[];
  /** The chrome-free route for launchers and native hosts, when the surface has one. */
  embed?: { path: `/embed/${string}`; profile: string };
};

export const SURFACE_CATALOG = [
  {
    id: "feed", label: "Feed", route: "/feed", status: "live",
    description: "Finished work from your agents, with the recorded discussion behind each item.",
    capabilities: ["read", "write", "live-updates", "embed"],
    embed: { path: "/embed/feed", profile: "macos.feed" },
  },
  {
    id: "chat", label: "Chat", route: "/chat", status: "planned",
    description: "Conversations with your agents and the channels they share.",
    capabilities: ["read", "write", "live-updates", "embed"],
  },
  {
    id: "sessions", label: "Sessions", route: "/sessions", status: "planned",
    description: "The harness sessions on this machine, turn by turn.",
    capabilities: ["read", "live-updates", "embed"],
  },
  {
    id: "board", label: "Board", route: "/board", status: "planned",
    description: "Work in flight across agents, from request to review.",
    capabilities: ["read", "write", "embed"],
  },
  {
    id: "control", label: "Control", route: "/control", status: "planned",
    description: "The runtime itself: agents, hosts and what each one is allowed to do.",
    capabilities: ["read", "write"],
  },
] as const satisfies readonly ScoutSurfaceDescriptor[];

export const capabilityLabels: Record<SurfaceCapability, string> = {
  read: "Reads the local runtime",
  write: "Sends changes the host authorizes",
  "live-updates": "Follows live runtime events",
  embed: "Mounts chrome-free in a launcher or native app",
};
