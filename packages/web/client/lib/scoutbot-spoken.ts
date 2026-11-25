import { stripScoutbotUiFences } from "./scoutbot.ts";
import { toSpokenScoutText } from "./spoken-text.ts";

/** A reply this short is read aloud as written. */
const READ_WHOLE_MAX = 320;
const ON_SCREEN = "The rest is on screen.";

/**
 * What the speaker says for a Scoutbot reply: the spoken version Scoutbot
 * wrote, or, when it wrote none, the reply itself if it is short and its
 * opening two sentences if it is long.
 */
export function spokenScoutbotReply(reply: { body: string; spoken?: string | null }): string {
  const said = reply.spoken?.trim();
  if (said) return toSpokenScoutText(said);
  const written = stripScoutbotUiFences(reply.body).trim();
  const whole = toSpokenScoutText(written);
  if (whole.length <= READ_WHOLE_MAX) return whole;
  const lead = toSpokenScoutText(openingProse(written));
  const sentences = lead.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const opening = sentences.slice(0, 2).join(" ") || lead;
  const clipped = opening.length > READ_WHOLE_MAX ? `${opening.slice(0, READ_WHOLE_MAX).replace(/\s+\S*$/, "")}.` : opening;
  return `${clipped} ${ON_SCREEN}`;
}

/** The first paragraph of prose: not a heading, list, table, quote or code. */
function openingProse(markdown: string): string {
  const blocks = markdown.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const prose = blocks.find((b) => !/^(```|#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>)/.test(b));
  return prose ?? (blocks[0] ?? "").replace(/^#{1,6}\s+/, "");
}
