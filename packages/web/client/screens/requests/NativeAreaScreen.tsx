import { getDestination } from "../../scout/nav-destinations.ts";
import { useScout } from "../../scout/Provider.tsx";
// The app's Inbox is the web's Inbox: the same composed panels the browser
// draws at /inbox (the list beside the open item), through the same resolver,
// so the two never drift apart.
import { resolveContentPane } from "../resolve-panes.tsx";
import { defineSurface, type EmbedScreenProps } from "../../surfaces/types.ts";

export function NativeAreaScreen({ navigate }: EmbedScreenProps) {
  const { route } = useScout();
  return <>{resolveContentPane(route.view === "requests" ? route : { view: "requests" }, navigate, undefined, { embedded: true })}</>;
}

export const scoutSurface = defineSurface({
  id: "requests",
  label: getDestination("requests").label,
  route: { view: "requests" },
  webPath: "/inbox",
  screen: "NativeAreaScreen",
  embed: {
    path: "/embed/requests",
    profile: "macos.requests",
    // Picking an item writes ?request= and stays on this page. Conversations,
    // terminals and every other area belong to the native shell.
    ownsInternalRoutes: true,
    chrome: { showSecondaryNav: false, showPageStatusBar: false },
    hosts: { macos: true },
  },
});
