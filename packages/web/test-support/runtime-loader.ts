import { plugin } from "bun";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { collectRuntimeAliases } from "./npm-runtime-aliases.ts";

const preserved = process.execArgv.includes("--preserve-symlinks")
  || /(?:^|\s)--preserve-symlinks(?:\s|$)/u.test(process.env.BUN_OPTIONS ?? "");

// Canonical web runs use Bun's native loader. This adapter is only for B's
// preserved-path web measurement, never a root-wide test preload.
if (preserved) {
  const require = createRequire(import.meta.url);
  const aliases = collectRuntimeAliases(resolve(import.meta.dir, ".."), [
    "react", "react-dom", "motion", "@base-ui-components/react",
  ]);
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  plugin({
    name: "private-web-composition-runtime",
    setup(build) {
      for (const logical of aliases.keys()) {
        // Match an actual symlink directory, not a package name or store layout.
        // Its real target cannot re-enter this hook. Unvisited physical copies,
        // including nested hoisted versions, are left to Bun's native loader.
        const filter = new RegExp(`^${escape(logical)}/.*\\.[cm]?js$`);
        build.onLoad({ filter }, ({ path }) => ({ loader: "object", exports: require(realpathSync(path)) }));
      }
    },
  });
}
