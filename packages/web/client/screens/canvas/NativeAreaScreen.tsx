import { useScout } from "../../scout/Provider.tsx";
import { defineSurface, type EmbedScreenProps } from "../../surfaces/types.ts";
import { useEmbedHeadline } from "../../surfaces/useEmbedHeadline.ts";
import { CanvasContent } from "./CanvasContent.tsx";

export function NativeAreaScreen({ navigate, project }: EmbedScreenProps & { project?: string }) {
  const { route } = useScout();
  useEmbedHeadline("Canvas", true);
  return <CanvasContent route={route.view === "canvas" ? route : { view: "canvas", ...(project ? { project } : {}) }} navigate={navigate} />;
}

export const scoutSurface = defineSurface({
  id: "canvas", label: "Canvas", route: { view: "canvas" }, webPath: "/workspace",
  screen: "NativeAreaScreen",
  embed: {
    path: "/embed/canvas", profile: "macos.canvas", ownsInternalRoutes: true,
    hosts: { macos: true },
    resolveEmbedProps: (params) => ({ project: params.get("project")?.trim() || undefined }),
  },
});
