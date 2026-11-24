import { createRoot } from "react-dom/client";
import { NativeAreaScreen } from "scout-preview-feed-client";
import { routeEmbeddedNavigation } from "scout-preview-feed-client/embed-navigation";
import { routePath } from "./lib/router.ts";
import { PreviewShell } from "./preview-shell.tsx";
import { defaultFeedHandoff } from "./screens/feed/feed-capabilities.tsx";
import "scout-preview-feed-client/theme.css";
import "./preview.css";

const url = new URL(location.href);

createRoot(document.getElementById("root")!).render(
  <PreviewShell url={url}>
    <NativeAreaScreen
      capabilities={{ readOnly: true, handoff: defaultFeedHandoff }}
      expand={url.searchParams.get("post") || undefined}
      navigate={route => routeEmbeddedNavigation(route, dest => location.assign(routePath(dest)))}
    />
  </PreviewShell>,
);
