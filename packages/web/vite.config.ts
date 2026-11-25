import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { resolveOpenScoutWebRoutes } from "./shared/runtime-config.js";

const require = createRequire(import.meta.url);

function devPerformanceEntriesPlugin(): Plugin {
  return {
    name: "scout-dev-clear-performance-entries",
    apply: "serve",
    transformIndexHtml: () => [{
      tag: "script",
      injectTo: "head-prepend",
      children: "setInterval(function(){try{performance.clearMeasures();performance.clearMarks();}catch(e){}},5000);",
    }],
  };
}

const webNodeModules = resolve(__dirname, "node_modules");
const bunTarget = process.env.OPENSCOUT_WEB_BUN_URL?.trim() || "http://127.0.0.1:4177";
const routes = resolveOpenScoutWebRoutes(process.env);
const viteHmrProtocol = process.env.OPENSCOUT_WEB_VITE_HMR_PROTOCOL?.trim() || undefined;
const viteHmrHost = process.env.OPENSCOUT_WEB_VITE_HMR_HOST?.trim() || undefined;
const viteHmrClientPort = Number.parseInt(
  process.env.OPENSCOUT_WEB_VITE_HMR_CLIENT_PORT?.trim() || "",
  10,
);

function resolveHudsonKitModule(id: string): string {
  return require.resolve(id, { paths: [__dirname] });
}


export default defineConfig({
  root: resolve(__dirname, "client"),
  clearScreen: false,
  plugins: [react(), tailwindcss(), devPerformanceEntriesPlugin()],
  define: { "import.meta.env.VITE_SCOUT_WEB_PROFILE": JSON.stringify("full") },
  server: {
    // The portal name (DEFAULT_SCOUT_WEB_PORTAL_HOST) and its subdomains, so
    // dev work is reachable as scout.local:43122 like the service is.
    allowedHosts: ["scout.local", ".scout.local"],
    hmr: {
      path: routes.viteHmrPath,
      ...(viteHmrProtocol ? { protocol: viteHmrProtocol } : {}),
      ...(viteHmrHost ? { host: viteHmrHost } : {}),
      ...(Number.isFinite(viteHmrClientPort) && viteHmrClientPort > 0
        ? { clientPort: viteHmrClientPort }
        : {}),
    },
    proxy: {
      "/api": { target: bunTarget, changeOrigin: false, ws: true },
      [routes.terminalRelayPath]: { target: bunTarget, changeOrigin: false, ws: true },
      [routes.terminalRelayHealthPath]: { target: bunTarget, changeOrigin: false, ws: false },
      [routes.tailStreamPath]: { target: bunTarget, changeOrigin: false, ws: true },
      [routes.eventsStreamPath]: { target: bunTarget, changeOrigin: false, ws: true },
    },
  },
  resolve: {
    alias: {
      "react": resolve(webNodeModules, "react"),
      "react-dom": resolve(webNodeModules, "react-dom"),
      "@hudsonkit/app-shell": resolveHudsonKitModule("hudsonkit/app-shell"),
      "@hudsonkit/shell": resolveHudsonKitModule("hudsonkit/shell"),
      "@hudsonkit/chrome": resolveHudsonKitModule("hudsonkit/chrome"),
      "@hudsonkit/controls": resolveHudsonKitModule("hudsonkit/controls"),
      "@hudsonkit/canvas": resolveHudsonKitModule("hudsonkit/canvas"),
      "@hudsonkit/overlays": resolveHudsonKitModule("hudsonkit/overlays"),
      "hudsonkit/terminal": resolveHudsonKitModule("hudsonkit/terminal"),
      "hudsonkit/flags": resolveHudsonKitModule("hudsonkit/flags"),
      "@hudsonkit/styles/tokens.css": resolveHudsonKitModule("hudsonkit/styles/tokens.css"),
      "@hudsonkit/styles": resolveHudsonKitModule("hudsonkit/styles"),
      // HudsonKit Arc is its own published package (the Canvas draws *.arc.json with it), not a HudsonKit source
      // module: it comes before "@hudsonkit", whose alias would otherwise take "@hudsonkit/arc" too. Its stylesheet is
      // imported by file (lib/arc.css), since an alias does not match "arc.css?inline" by its export name
      "@hudsonkit/arc": resolve(webNodeModules, "@hudsonkit/arc"),
      "@hudsonkit": resolveHudsonKitModule("hudsonkit"),
      "@xterm/addon-fit": resolveHudsonKitModule("@xterm/addon-fit"),
      "@xterm/addon-webgl": resolveHudsonKitModule("@xterm/addon-webgl"),
      "@xterm/xterm/css/xterm.css": resolveHudsonKitModule("@xterm/xterm/css/xterm.css"),
      "@xterm/xterm": resolveHudsonKitModule("@xterm/xterm"),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist/client"),
    rollupOptions: { input: { main: resolve(__dirname, "client/index.html"), companion: resolve(__dirname, "client/companion.html"), voiceNoteConnect: resolve(__dirname, "client/voice-note-connect.html") } },
    emptyOutDir: true,
    sourcemap: false,
  },
});
