import { getDestination } from "../../scout/nav-destinations.ts";
import { useScout } from "../../scout/Provider.tsx";
// The app's Hosts page is the web's: the same mesh page, through the same
// resolver, so the two never drift apart.
import { resolveContentPane } from "../resolve-panes.tsx";
import { defineSurface, type EmbedScreenProps } from "../../surfaces/types.ts";

export function NativeAreaScreen({ navigate }: EmbedScreenProps) {
  const { route } = useScout();
  return <>{resolveContentPane(route.view === "mesh" ? route : { view: "mesh" }, navigate, undefined, { embedded: true })}</>;
}

export const scoutSurface = defineSurface({
  id: "hosts",
  label: getDestination("mesh").label,
  route: { view: "mesh" },
  webPath: "/mesh",
  screen: "NativeAreaScreen",
  embed: {
    path: "/embed/hosts",
    profile: "macos.hosts",
    // Opening a host stays on this page; every other area belongs to the
    // native shell.
    ownsInternalRoutes: true,
    hosts: { macos: true },
  },
});
