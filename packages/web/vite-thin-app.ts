import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild, defineConfig, type Plugin, type UserConfig } from "vite";
import {
  BOOT_SHELL_CRITICAL_CSS,
  renderBootShellHtml,
  type ScoutSkeletonVariant,
  type ScoutRail,
} from "./client/shell/boot-html.ts";

const webDir = dirname(fileURLToPath(import.meta.url));
const requireFromWeb = createRequire(import.meta.url);
const webNodeModules = resolve(webDir, "node_modules");

function resolveFromWeb(id: string): string {
  return requireFromWeb.resolve(id, { paths: [webDir] });
}

export interface ScoutThinViteOptions {
  /** Display noun after "Scout ", e.g. "Feed", "Sessions", "Search". */
  product: string;
  /** Initial HTML skeleton painted inside `<div id="root">` before JS runs. */
  variant: ScoutSkeletonVariant;
  /** Match the frame rail when overriding the variant default. */
  rail?: ScoutRail;
  /** Default dev server port. */
  port?: number;
  /** Optional Node HTTP middleware for `/api/*` during `vite` dev. */
  apiHandler?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean;
  /** Optional server entry bundled to `<outDir>/thin-server.mjs` during `vite build`. */
  serverEntry?: string;
  /** Output directory (defaults to `dist`). */
  outDir?: string;
}

function scoutBootSkeletonPlugin(product: string, variant: ScoutSkeletonVariant, rail?: ScoutRail): Plugin {
  return {
    name: "scout-boot-skeleton-html",
    transformIndexHtml(html) {
      const bootHtml = renderBootShellHtml({ product, variant, rail });
      const withStyle = html.includes("</head>")
        ? html.replace("</head>", `<style id="scout-boot-css">${BOOT_SHELL_CRITICAL_CSS}</style>\n</head>`)
        : html;
      return withStyle.replace(
        /<div\s+id=["']root["']\s*>\s*<\/div>/i,
        `<div id="root">${bootHtml}</div>`,
      );
    },
  };
}

export function scoutAppResolveAliases(): Record<string, string> {
  return {
    "react": resolve(webNodeModules, "react"),
    "react-dom": resolve(webNodeModules, "react-dom"),
    "@hudsonkit/app-shell": resolveFromWeb("hudsonkit/app-shell"),
    "@hudsonkit/shell": resolveFromWeb("hudsonkit/shell"),
    "@hudsonkit/chrome": resolveFromWeb("hudsonkit/chrome"),
    "@hudsonkit/controls": resolveFromWeb("hudsonkit/controls"),
    "@hudsonkit/canvas": resolveFromWeb("hudsonkit/canvas"),
    "@hudsonkit/overlays": resolveFromWeb("hudsonkit/overlays"),
    "hudsonkit/terminal": resolveFromWeb("hudsonkit/terminal"),
    "hudsonkit/flags": resolveFromWeb("hudsonkit/flags"),
    "hudsonkit/theme": resolveFromWeb("hudsonkit/theme"),
    "@hudsonkit/styles/tokens.css": resolveFromWeb("hudsonkit/styles/tokens.css"),
    "@hudsonkit/styles": resolveFromWeb("hudsonkit/styles"),
    "@hudsonkit/arc": resolve(webNodeModules, "@hudsonkit/arc"),
    "@hudsonkit": resolveFromWeb("hudsonkit"),
  };
}

export function defineScoutThinViteConfig(options: ScoutThinViteOptions): UserConfig {
  const plugins: Plugin[] = [
    react() as unknown as Plugin,
    tailwindcss() as unknown as Plugin,
    scoutBootSkeletonPlugin(options.product, options.variant, options.rail),
  ];

  if (options.apiHandler) {
    const handler = options.apiHandler;
    plugins.push({
      name: "scout-thin-dev-api",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!(await handler(req, res))) next();
        });
      },
    });
  }

  const outDir = options.outDir ?? "dist";

  if (options.serverEntry) {
    const serverEntry = options.serverEntry;
    let buildingServer = false;
    plugins.push({
      name: "scout-thin-server-bundle",
      apply: "build",
      async closeBundle() {
        if (buildingServer) return;
        buildingServer = true;
        try {
          await viteBuild({
            configFile: false,
            clearScreen: false,
            logLevel: "warn",
            resolve: {
              alias: {
                "scout-app/thin-server": resolve(webDir, "thin-server/index.ts"),
              },
            },
            ssr: {
              noExternal: true,
              external: [/^node:/, /^@openscout\/scout(\/.*)?$/],
            },
            build: {
              ssr: serverEntry,
              outDir,
              emptyOutDir: false,
              sourcemap: false,
              target: "node20",
              rollupOptions: {
                external: [/^node:/, /^@openscout\/scout(\/.*)?$/],
                output: {
                  format: "es",
                  entryFileNames: "thin-server.mjs",
                },
              },
            },
          });
        } finally {
          buildingServer = false;
        }
      },
    });
  }

  return defineConfig({
    clearScreen: false,
    plugins,
    define: {
      "import.meta.env.VITE_SCOUT_WEB_PROFILE": JSON.stringify("thin"),
    },
    resolve: {
      alias: scoutAppResolveAliases(),
    },
    server: {
      host: "127.0.0.1",
      port: options.port ?? 4810,
      strictPort: false,
    },
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: false,
    },
  });
}
