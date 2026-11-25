import { expect, test, mock } from "bun:test";
// @ts-expect-error Direct entry avoids TypeScript path aliases in Bun's React renderer.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Direct entry avoids TypeScript path aliases in Bun's React renderer.
const jsx = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Direct entry avoids TypeScript path aliases in Bun's React renderer.
const dev = await import("../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Direct entry avoids TypeScript path aliases in Bun's React renderer.
const { renderToStaticMarkup } = await import("../../../node_modules/react-dom/server.node.js");
mock.module("react", () => React); mock.module("react/jsx-runtime", () => jsx); mock.module("react/jsx-dev-runtime", () => dev);
const { ChatAudioNote, audioClock } = await import("./ChatAudioNote.tsx");
test("formats only known timing and provides real keyboard controls", () => {
  expect(audioClock(67.9)).toBe("1:07"); expect(audioClock(Infinity)).toBe("0:00");
  const html = renderToStaticMarkup(React.createElement(ChatAudioNote, { href: "/audio.webm", name: "voice.webm" }));
  expect(html).toContain('aria-label="Play voice note"'); expect(html).toContain('aria-label="Seek in voice note"');
  expect(html).toContain('aria-label="Download voice note"'); expect(html).not.toContain(" / 0:00"); expect(html).not.toContain(" controls");
});
test("renders background status and a labelled transcript without replacing the recording", () => {
  const render = (status: "queued" | "ready" | "failed") => renderToStaticMarkup(React.createElement(ChatAudioNote, { href: "/voice.webm", name: "voice.webm", transcription: { status, updatedAt: 1, text: "Spoken words" } }));
  expect(render("queued")).toContain("Transcribing…"); expect(render("ready")).toContain("Spoken words");
  expect(render("ready")).toContain("Transcript"); expect(render("failed")).toContain("Audio saved");
  expect(render("ready")).toContain('src="/voice.webm"');
});
test("uses measured recorder timing before WebM metadata has a finite duration", () => {
  const html = renderToStaticMarkup(React.createElement(ChatAudioNote, { href: "/voice.webm", name: "voice.webm", durationHint: 12.3, compact: true }));
  expect(html).toContain('max="12.3"');
  expect(html).toContain('aria-valuetext="0:00 of 0:12"');
  expect(html).not.toContain('aria-label="Seek in voice note" disabled');
});
