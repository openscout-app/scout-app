import { getDestination } from "../../scout/nav-destinations.ts";
import { useScout } from "../../scout/Provider.tsx";
// The app's Home is the web's Home: the same composed panels the browser draws
// at /, through the same resolver, so the two never drift apart again.
import { resolveContentPane } from "../resolve-panes.tsx";
import { defineSurface, type EmbedScreenProps } from "../../surfaces/types.ts";


export function NativeAreaScreen({ navigate }: EmbedScreenProps) {
  const { route } = useScout();
  return <>{resolveContentPane(route.view === "inbox" ? route : { view: "inbox" }, navigate, undefined, { embedded: true })}</>;
}

export const scoutSurface = defineSurface({
  id: "home",
  label: getDestination("home").label,
  route: { view: "inbox" },
  webPath: "/",
  screen: "NativeAreaScreen",
  embed: {
    path: "/embed/home",
    profile: "macos.home",
    ownsInternalRoutes: true,
    hosts: { macos: true },
  },
});
