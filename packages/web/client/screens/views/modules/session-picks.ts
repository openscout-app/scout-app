import { createBriefingPicks } from "./briefing-pick.ts";

/*
 * What each Session board panel has selected, so a Session thread panel
 * beside it that shows picks can show it without either one moving the page.
 * The same store Briefings uses (briefing-pick.ts), over session pins
 * (sessions-view-model.ts › encodeSessionPin) instead of briefing ids:
 *
 *   - A Session board publishes the session it marks under its instance id
 *     (its own pick, the page's session on /sessions/:ref, or the first row
 *     it shows) and withdraws when it goes.
 *   - A Session thread that shows picks (unset, or following the page off a
 *     Sessions page) shows the latest, and counts itself in, so a board off
 *     its page knows a pick will show somewhere. With none, a row opens the
 *     session's own page instead.
 */
export const sessionPicks = createBriefingPicks();
