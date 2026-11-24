import { createRoot } from "react-dom/client";
import { ScoutApp } from "./shell/ScoutApp.tsx";
import { readRuntimeInfo } from "./shell/runtime.ts";
import { readT3CodeUrl } from "./shell/t3code.ts";
import { defaultFeedHandoff } from "./screens/feed/feed-capabilities.tsx";
import "scout-preview-feed-client/theme.css";
import "./preview.css";

// `/` and the surface routes open the app shell; `/embed/feed` is the chrome-free Feed launchers open.
createRoot(document.getElementById("root")!).render(
  <ScoutApp
    url={new URL(location.href)}
    runtime={readRuntimeInfo(document)}
    t3codeUrl={readT3CodeUrl(document)}
    capabilities={{ readOnly: true, handoff: defaultFeedHandoff }}
  />,
);
