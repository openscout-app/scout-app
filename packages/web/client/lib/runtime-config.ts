/** Live subscriptions are served by the same local runtime as the page. */
function streamUrl(key: "tailStreamPath" | "eventsStreamPath", fallback: string): string {
  const bootstrap = (window as Window & {
    __OPENSCOUT_WEB_BOOTSTRAP__?: { routes?: Partial<Record<typeof key, string>> };
  }).__OPENSCOUT_WEB_BOOTSTRAP__;
  const raw = bootstrap?.routes?.[key]?.trim() || fallback;
  const path = ("/" + raw).replace(/\/{2,}/g, "/").replace(/\/+$/g, "") || fallback;
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`;
}
export const resolveScoutEventsStreamUrl = () => streamUrl("eventsStreamPath", "/ws/events");
export const resolveScoutTailStreamUrl = () => streamUrl("tailStreamPath", "/ws/tail");
