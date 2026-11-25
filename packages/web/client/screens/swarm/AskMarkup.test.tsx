import { describe, expect, mock, test } from "bun:test";

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../../node_modules/react-dom/server.node.js");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);

const { AskMarkup } = await import("./AskMarkup.tsx");

const draw = (text: string): string => renderToStaticMarkup(createElement(AskMarkup, { text }));

describe("AskMarkup", () => {
  test("draws a lane's reply: its link, its code and its evidence table", () => {
    const html = draw([
      "Draft [#133](https://github.com/arach/scout/pull/133), head `0fe8eb9e`, stacked on stage 4.",
      "",
      "| Base owners components | Head command | Limit |",
      "|---|---|---|",
      "| pairing-capsule + credential-ownership | `bun run test:unit:source:pairing` | 15m |",
      "| process-launch-fences | `bun run test:process-launch-fences` | 10m |",
    ].join("\n"));
    expect(html).toContain('<a class="swarm-md__link" href="https://github.com/arach/scout/pull/133" target="_blank" rel="noreferrer">#133</a>');
    expect(html).toContain('<code class="swarm-md__code">0fe8eb9e</code>');
    expect(html).toContain("<th>Base owners components</th>");
    expect(html).toContain('<td><code class="swarm-md__code">bun run test:process-launch-fences</code></td>');
    expect(html).not.toContain("|---|");
  });

  test("keeps a brief's lines and its path as words, outside the app's provider", () => {
    const html = draw("The fence matrix: give each fence suite its own CI job\n\nFrom Claude, running point. Brief: /private/tmp/claude-501/scratchpad/lane-t-fence-matrix-brief.md");
    expect(html).toBe('<div class="swarm-md"><p class="swarm-md__p">The fence matrix: give each fence suite its own CI job</p><p class="swarm-md__p">From Claude, running point. Brief: /private/tmp/claude-501/scratchpad/lane-t-fence-matrix-brief.md</p></div>');
  });

  test("draws lists, a bold lead with code inside, and a rule as a break", () => {
    const html = draw("**Claude verified it at `0fe8eb9e`:**\n\n- all 35 hashes pass;\n- the guard passes 5 of 5.\n\n---\n\nDone.");
    expect(html).toContain('<strong>Claude verified it at <code class="swarm-md__code">0fe8eb9e</code>:</strong>');
    expect(html).toContain('<ul class="swarm-md__list"><li>all 35 hashes pass;</li><li>the guard passes 5 of 5.</li></ul>');
    expect(html).toContain('<div class="swarm-md__break" role="separator"></div>');
  });

  test("gives a code block a copy button beside its text", () => {
    const html = draw("Run it:\n\n```sh\nbun run web:check\n```");
    expect(html).toContain('<div class="swarm-md__codeblock"><pre class="swarm-md__pre"><code>bun run web:check</code></pre><button type="button" class="swarm-md__copy" data-state="idle" aria-label="Copy code" title="Copy code">');
    expect(html.match(/swarm-md__copy/g)?.length).toBe(1);
  });

  test("puts no copy button on inline code", () => {
    expect(draw("Head `0fe8eb9e`.")).not.toContain("swarm-md__copy");
  });
});
