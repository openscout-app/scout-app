import { getDestination } from "../../scout/nav-destinations.ts";
import { useScout } from "../../scout/Provider.tsx";
// The app's Sessions page is the web's: the same board and session pages,
// through the same resolver, so the two never drift apart.
import { resolveContentPane } from "../resolve-panes.tsx";
import { defineSurface, type EmbedScreenProps } from "../../surfaces/types.ts";

export function NativeAreaScreen({ navigate }: EmbedScreenProps) {
  const { route } = useScout();
  return <>{resolveContentPane(route.view === "sessions" ? route : { view: "sessions" }, navigate, undefined, { embedded: true })}</>;
}

export const scoutSurface = defineSurface({
  id: "sessions",
  label: getDestination("sessions").label,
  route: { view: "sessions" },
  webPath: "/sessions",
  screen: "NativeAreaScreen",
  embed: {
    path: "/embed/sessions",
    profile: "macos.sessions",
    // Opening a session from the board stays on this page. Terminals, Lanes
    // and every other area belong to the native shell.
    ownsInternalRoutes: true,
    hosts: { macos: true },
  },
});
