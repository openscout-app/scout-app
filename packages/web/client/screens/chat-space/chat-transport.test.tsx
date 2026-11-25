import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { useChatTransport } from "./chat-transport.tsx";

test("local chat stamps Scout as its source", () => {
  function Probe() {
    const { source } = useChatTransport();
    return <div data-chat-source={source} />;
  }

  expect(renderToStaticMarkup(<Probe />)).toContain('data-chat-source="scout"');
});
