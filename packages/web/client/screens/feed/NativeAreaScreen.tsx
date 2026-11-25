import { defineSurface, type EmbedScreenProps } from "../../surfaces/types.ts";
import { useEmbedHeadline } from "../../surfaces/useEmbedHeadline.ts";
import { FeedContent } from "./FeedContent.tsx";
import type { FeedCapabilities } from "./feed-capabilities.tsx";

/** The Feed in the Mac app's Feed row: the same page the web draws at /feed. */
export function NativeAreaScreen({ navigate, expand, capabilities }: EmbedScreenProps & {
  expand?: string;
  capabilities?: Partial<FeedCapabilities>;
}) {
  useEmbedHeadline("Feed", true);
  return <FeedContent navigate={navigate} expand={expand} capabilities={capabilities} />;
}

export const scoutSurface = defineSurface({
  id: "feed", label: "Feed", route: { view: "feed" }, webPath: "/feed",
  screen: "NativeAreaScreen",
  embed: { path: "/embed/feed", profile: "macos.feed", hosts: { macos: true } },
});
