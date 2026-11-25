import { expect, test } from "bun:test";
import { SourceTextModule, createContext, runInContext } from "node:vm";

async function loadBrowserBundle(entrypoint: string, define?: Record<string, string>) {
  const build = await Bun.build({
    entrypoints: [`${import.meta.dir}/${entrypoint}`],
    target: "browser",
    format: "esm",
    define,
  });
  const script = build.outputs.find(file => file.kind === "entry-point" && file.path.endsWith(".js"));
  if (!script) throw new Error("The browser build did not emit a JS entry point");

  const context = createContext({ URL, URLSearchParams });
  expect(runInContext("'process' in globalThis", context)).toBe(false);
  const module = new SourceTextModule(await script.text(), { context });
  await module.link(specifier => { throw new Error(`Unexpected external import: ${specifier}`); });
  await module.evaluate();
  return module.namespace;
}

test("the documented browser embed loads without a process global or build defines", async () => {
  const embed = await loadBrowserBundle("index.ts");
  for (const name of ["NativeAreaScreen", "FeedContent", "FeedStream", "FeedStandaloneSurface", "FeedItem", "FeedCapabilitiesProvider", "useFeedCapabilities"]) {
    expect(typeof Reflect.get(embed, name)).toBe("function");
  }
  expect(embed).toHaveProperty("scoutSurface.embed.path", "/embed/feed");
});

test("the legacy build flag enables read-only mode without a process global", async () => {
  const capabilities = await loadBrowserBundle("../../lib/preview-capabilities.ts", {
    __SCOUT_FEED_READ_ONLY__: "true",
  });
  expect(capabilities).toHaveProperty("readOnlyPreview", true);
});
