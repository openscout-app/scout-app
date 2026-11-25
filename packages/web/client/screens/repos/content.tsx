import type { Route } from "../../lib/types.ts";
import type { useScout } from "../../scout/Provider.tsx";
import { ChangesPage } from "./ChangesPage.tsx";

type Navigate = ReturnType<typeof useScout>["navigate"];

/** /repos and /repo-diff: the Changes page, one fixed page with two layouts (ChangesPage.tsx). */
export function ReposContent({ route, navigate }: { route: Route; navigate: Navigate }) {
  if (route.view === "repos" || route.view === "repo-diff") return <ChangesPage route={route} navigate={navigate} />;
  return null;
}
