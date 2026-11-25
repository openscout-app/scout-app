/**
 * The bridge between the web Settings page and the Scout app that hosts it.
 *
 * Settings is one web page. The Mac app (and the menu's Settings window) show
 * it in a WKWebView and register a `scoutSettings` message handler. Through it
 * the page reads what only the host knows (versions, updates, permissions,
 * window and terminal preferences) and asks the host to change or open things.
 * In a plain browser there is no handler: `hostSettingsAvailable()` is false and
 * the page leaves out every group that needs the host.
 *
 * Wire format
 *   page → host   postMessage({ kind: "settings-request", id, method, params })
 *   host → page   window.__scoutSettingsReply(id, { ok: true, value } | { ok: false, error })
 *   host → page   window.dispatchEvent(new CustomEvent("scout:host-settings", { detail: HostSettingsSnapshot }))
 *                 whenever anything in the snapshot changes (an update is found,
 *                 a permission is granted, a preference changes elsewhere).
 *
 * Methods
 *   snapshot                        → HostSettingsSnapshot
 *   set          { key, value }     → HostSettingsSnapshot   (key: HostSettingKey)
 *   permission   { kind }           → HostSettingsSnapshot   (asks macOS; kind: HostPermissionKind)
 *   update.check                    → HostSettingsSnapshot   (Sparkle check; UI only if it finds one)
 *   update.install                  → null                   (Sparkle takes over: download, relaunch)
 *   network.setup                   → HostSettingsSnapshot   (menu only: sign in / publish / start relay)
 *   open         { target }         → null                   (HostOpenTarget)
 *   desk.status                     → HostDeskStatus         (Scout Desk installed / running)
 *   desk.call    { method, params } → unknown                (one Scout Desk Settings method, over its socket)
 *   desk.launch                     → HostDeskStatus         (opens Scout Desk in the background)
 *   host → page  CustomEvent("scout:desk-settings", { detail: { type: "changed" | "permissions" | "desk", … } })
 *                 when Scout Desk's own Settings changes something, or Desk starts or quits.
 *
 * Nothing secret crosses this bridge. Keys stay in the Keychain on the host.
 */

export type HostPermissionState = "granted" | "denied" | "not-determined" | "restricted" | "unknown";
export type HostPermissionKind = "microphone" | "speech" | "notifications" | "accessibility";

export type HostUpdateState = {
  /** false for dev and ad-hoc bundles, where Sparkle is inert */
  supported: boolean;
  checking: boolean;
  /** the newer version Sparkle found, or null when up to date / not yet checked */
  availableVersion: string | null;
  /** ISO time of the last completed check */
  lastCheckedAt: string | null;
  automaticChecks: boolean;
  /** true in the menu: the Scout app owns Sparkle; the menu can only hand it the install */
  delegated?: boolean;
};

/** OpenScout Network publishing, which the menu owns. Null in the app. */
export type HostNetworkState = {
  status: string;
  detail: string;
  discoveryEnabled: boolean;
  keepRelayRunning: boolean;
  signedIn: boolean;
  rendezvousURL: string;
  relayURL: string;
  settingsPath: string;
  /** the next step the menu would take: "Sign in and publish", "Republish", … */
  setupLabel: string;
  pending: boolean;
};

export type HostSettingsSnapshot = {
  host: {
    /** "app" = the Scout app's Settings; "menu" = the menu's Settings window */
    surface: "app" | "menu";
    appVersion: string;
    build: string | null;
    machineName: string;
    osVersion: string;
  };
  update: HostUpdateState;
  /** accessibility only from the Scout app, which is what holds that grant */
  permissions: Record<Exclude<HostPermissionKind, "accessibility">, HostPermissionState> & {
    accessibility?: HostPermissionState;
  };
  window: {
    cornerTemplate?: string | null;
    sidebarMaterial: string;
    sidebarMaterialOptions: HostOption[];
    sidebarBlur: string;
    sidebarBlurOptions: HostOption[];
    /** 0…1 */
    sidebarTint: number;
    /** 0…1 */
    contentOpacity: number;
    /**
     * The frame's backdrop and its sidebar part, and the page's backdrop.
     * Demo app before the Frame › Page vocabulary report only the legacy
     * `backdrop` / `sidebarBackdrop` pair (and take `window.backdrop` /
     * `window.sidebarBackdrop`); older ones report none, and the page then
     * keeps its backdrops to itself.
     */
    frameBackdrop?: string;
    frameBackdropOptions?: HostOption[];
    frameSidebarBackdrop?: string;
    frameSidebarBackdropOptions?: HostOption[];
    pageBackdrop?: string;
    pageBackdropOptions?: HostOption[];
    /** Legacy name of frameBackdrop. */
    backdrop?: string;
    backdropOptions?: HostOption[];
    /** Legacy name of frameSidebarBackdrop. */
    sidebarBackdrop?: string;
    sidebarBackdropOptions?: HostOption[];
    /** Your own's corners, "#rrggbb …" */
    backdropColors?: string;
    holdMaterialWhenUnfocused: boolean;
    previewAccentsOnHover: boolean;
    conversationPresentation: string;
    conversationPresentationOptions: HostOption[];
    reduceTransparency: boolean;
  } | null;
  terminal: {
    renderer: string;
    rendererOptions: HostOption[];
    fontFamily: string;
    fontFamilyOptions: HostOption[];
    fontSize: number;
    tileHeaders: boolean;
    preferredTerminalAppPath: string;
    terminalAppOptions: HostOption[];
  } | null;
  attention: {
    notifyWhenNeeded: boolean;
    playSound: boolean;
    dockBadge: boolean;
  } | null;
  /** Which shared room the app's Spaces seat opens; absent from older hosts */
  spaces?: {
    origin: string;
    originOptions: HostOption[];
    /** host of the hosted room, e.g. chat.openscout.app */
    hostedHost: string;
  } | null;
  spokenReplies: {
    taskAnnouncementsEnabled: boolean;
    voice: string;
    voiceOptions: HostOption[];
    model: string;
    modelOptions: HostOption[];
  } | null;
  network?: HostNetworkState | null;
};

export type HostOption = { value: string; label: string };

/** What a voice test actually played. `fallbackReason` is set when the chosen
 * voice failed and the macOS system voice spoke instead. */
export type HostVoiceTest =
  | { outcome: "finished"; modelId: string; voiceId: string; providerId: string; fallbackReason: string | null }
  | { outcome: "cancelled" }
  | { outcome: "failed"; error: string };

export type HostSettingKey =
  | "window.cornerTemplate"
  | "window.sidebarMaterial"
  | "window.sidebarBlur"
  | "window.sidebarTint"
  | "window.contentOpacity"
  | "window.frameBackdrop"
  | "window.frameSidebarBackdrop"
  | "window.pageBackdrop"
  /** Legacy alias of window.frameBackdrop, for Demo app that predate it. */
  | "window.backdrop"
  /** Legacy alias of window.frameSidebarBackdrop, for Demo app that predate it. */
  | "window.sidebarBackdrop"
  | "window.backdropColors"
  | "window.holdMaterialWhenUnfocused"
  | "window.previewAccentsOnHover"
  | "window.conversationPresentation"
  | "terminal.renderer"
  | "terminal.fontFamily"
  | "terminal.fontSize"
  | "terminal.tileHeaders"
  | "terminal.preferredTerminalAppPath"
  | "attention.notifyWhenNeeded"
  | "attention.playSound"
  | "attention.dockBadge"
  | "spaces.origin"
  | "spokenReplies.voice"
  | "spokenReplies.taskAnnouncementsEnabled"
  | "spokenReplies.model"
  | "update.automaticChecks"
  | "network.discoveryEnabled"
  | "network.keepRelayRunning";

export type HostOpenTarget =
  | "connected-assistants"
  | "sound-settings"
  | "notification-settings"
  | "privacy-microphone"
  | "privacy-speech"
  | "privacy-accessibility"
  | "logs"
  | "network-settings-file";

type Reply = { ok: true; value: unknown } | { ok: false; error: string };

type HandlerWindow = Window & {
  webkit?: { messageHandlers?: { scoutSettings?: { postMessage: (body: unknown) => void } } };
  __scoutSettingsReply?: (id: string, reply: Reply) => void;
};

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let sequence = 0;

function handler() {
  if (typeof window === "undefined") return null;
  return (window as HandlerWindow).webkit?.messageHandlers?.scoutSettings ?? null;
}

export function hostSettingsAvailable(): boolean {
  return handler() !== null;
}

function installReply() {
  const w = window as HandlerWindow;
  if (w.__scoutSettingsReply) return;
  w.__scoutSettingsReply = (id, reply) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (reply.ok) entry.resolve(reply.value);
    else entry.reject(new Error(reply.error || "The Scout app could not do that."));
  };
}

function call<T>(method: string, params?: Record<string, unknown>, timeoutMs = 8000): Promise<T> {
  const h = handler();
  if (!h) return Promise.reject(new Error("Settings is not open in the Scout app."));
  installReply();
  const id = `s${++sequence}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error("The Scout app did not answer."));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v as T);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    h.postMessage({ kind: "settings-request", id, method, params: params ?? {} });
  });
}

export const hostSettings = {
  snapshot: () => call<HostSettingsSnapshot>("snapshot"),
  speechCatalog: () => call<HostSettingsSnapshot>("spokenReplies.catalog"),
  /** Speaks a sample with this Mac's voice; resolves when playback ends. */
  testVoice: () => call<HostVoiceTest>("spokenReplies.test", undefined, 45000),
  set: (key: HostSettingKey, value: string | number | boolean) =>
    call<HostSettingsSnapshot>("set", { key, value }),
  requestPermission: (kind: HostPermissionKind) => call<HostSettingsSnapshot>("permission", { kind }),
  checkForUpdates: () => call<HostSettingsSnapshot>("update.check"),
  installUpdate: () => call<null>("update.install"),
  open: (target: HostOpenTarget) => call<null>("open", { target }),
  setUpNetwork: () => call<HostSettingsSnapshot>("network.setup"),
  /** Reads the desktop picture into Your own's corners and switches to Your own. */
  backdropFromDesktop: () => call<HostSettingsSnapshot>("backdrop.fromDesktop"),
};

/** Scout Desk, the optional desktop utility. Desk owns its values; Scout only calls Desk's Settings methods. */
export type HostDeskStatus = {
  installed: boolean;
  running: boolean;
  appPath: string | null;
  home: string;
  /** Where Desk's own Settings pages are served, while Desk is running; Scout mounts them with `?host=scout`. */
  settingsURL?: string | null;
};

export type HostDeskEvent =
  | { type: "changed" }
  | { type: "permissions"; list?: unknown }
  | { type: "desk"; running: boolean }
  | { type: string; [key: string]: unknown };

export const hostDesk = {
  status: () => call<HostDeskStatus>("desk.status"),
  call: <T = unknown>(method: string, params?: Record<string, unknown>) =>
    call<T>("desk.call", { method, params: params ?? {} }, 15000),
  launch: () => call<HostDeskStatus>("desk.launch", undefined, 15000),
};

export function onHostDesk(listener: (event: HostDeskEvent) => void): () => void {
  const fn = (event: Event) => listener((event as CustomEvent<HostDeskEvent>).detail);
  window.addEventListener("scout:desk-settings", fn);
  return () => window.removeEventListener("scout:desk-settings", fn);
}

/** Subscribe to snapshots the host pushes when something changes. */
export function onHostSettings(listener: (snapshot: HostSettingsSnapshot) => void): () => void {
  const fn = (event: Event) => listener((event as CustomEvent<HostSettingsSnapshot>).detail);
  window.addEventListener("scout:host-settings", fn);
  return () => window.removeEventListener("scout:host-settings", fn);
}
