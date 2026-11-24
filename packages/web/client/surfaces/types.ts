import type { Route } from "../lib/types.ts";

/** Props every embed-capable screen accepts at minimum. */
export type EmbedScreenProps = {
  navigate: (route: Route) => void;
  embedded?: boolean;
};

type SurfaceDefinition = {
  id: string;
  label: string;
  route: Route;
  webPath: string;
  screen: string;
  embed: { path: string; profile: string; hosts: { macos: boolean } };
};

/** Identity helper — screens export a `scoutSurface` description beside the component. */
export function defineSurface<const T extends SurfaceDefinition>(definition: T): T {
  return definition;
}
