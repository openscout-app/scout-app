import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { collectDiagnosticReport, diagnosticSource, submitPreparedDiagnosticReport, type DiagnosticReport, type DiagnosticReceipt } from "@openscout/runtime/diagnostic-report";
import { readJsonBody } from "../request-body.ts";
import type { FeedbackPreview } from "../../shared/api/feedback.ts";

const previewBody = z.object({ note: z.string().trim().min(1).max(8000), client: z.enum(["web", "macos"]).default("web") }).strict();
const sendBody = z.object({ token: z.string().uuid() }).strict();
const DRAFT_TTL = 10 * 60_000;
const MAX_DRAFTS = 20;
type Draft = FeedbackPreview & { sending?: Promise<DiagnosticReceipt>; receipt?: DiagnosticReceipt };
type Deps = { collect?: typeof collectDiagnosticReport; submit?: typeof submitPreparedDiagnosticReport; now?: () => number };

/** Uses the existing private report service. Preview only collects note/basic
 * metadata. Sending accepts an opaque draft token, never caller-supplied reports,
 * attachments, endpoints or diagnostic options. Operator API auth applies first. */
export function mountFeedbackRoutes(app: Hono, deps: Deps = {}) {
  const collect = deps.collect ?? collectDiagnosticReport;
  const submit = deps.submit ?? submitPreparedDiagnosticReport;
  const now = deps.now ?? Date.now;
  const drafts = new Map<string, Draft>();
  let preparing = 0;
  const prune = () => { for (const [token, draft] of drafts) if (!draft.sending && draft.expiresAt <= now()) drafts.delete(token); };
  app.use("/api/feedback/*", bodyLimit({ maxSize: 40_000, onError: c => c.json({ error: "Feedback is too long. Keep it under 8,000 characters." }, 413) }));
  app.use("/api/feedback/*", async (c, next) => { c.header("Cache-Control", "no-store"); await next(); });

  app.post("/api/feedback/preview", async c => {
    const input = await readJsonBody(c, previewBody);
    if (!input.ok) return input.response;
    prune();
    if (drafts.size + preparing >= MAX_DRAFTS) return c.json({ error: "Too many feedback drafts. Wait a few minutes and try again." }, 429);
    preparing++;
    try {
      const raw = await collect({ message: input.body.note, diagnostics: false, client: input.body.client });
      // An explicit allowlist prevents future collector fields from expanding
      // this minimal flow. No process IDs, sender, paths or diagnostic sections.
      const report: DiagnosticReport = {
        id: raw.id, timestamp: raw.timestamp,
        system: { os: raw.system.os, osVersion: raw.system.osVersion, chip: raw.system.chip, memory: raw.system.memory },
        apps: { collector: { running: true, ...(raw.apps.collector?.version ? { version: raw.apps.collector.version } : {}) } },
        context: { source: diagnosticSource(input.body.client), userDescription: raw.context.userDescription, reportSections: [] }, logs: [],
      };
      const draft: Draft = { token: randomUUID(), expiresAt: now() + DRAFT_TTL, report };
      drafts.set(draft.token, draft);
      const token = draft.token;
      const expiry = setTimeout(() => drafts.delete(token), DRAFT_TTL);
      expiry.unref?.();
      return c.json({ token: draft.token, expiresAt: draft.expiresAt, report });
    } catch { return c.json({ error: "Could not prepare feedback. Your note has not been sent. Try again." }, 503); }
    finally { preparing--; }
  });

  app.post("/api/feedback/send", async c => {
    const input = await readJsonBody(c, sendBody);
    if (!input.ok) return input.response;
    prune();
    const draft = drafts.get(input.body.token);
    if (!draft) return c.json({ error: "This preview expired or the host restarted. Review your note again before sending." }, 410);
    try {
      if (draft.receipt?.status !== "uploaded") {
        // Concurrent clicks share one upload. Failed uploads keep the same
        // immutable preview and private local copy for an explicit retry.
        if (!draft.sending) draft.sending = submit(draft.report);
        const sending = draft.sending;
        try { draft.receipt = await sending; } finally { if (draft.sending === sending) draft.sending = undefined; }
      }
      return c.json({ id: draft.receipt!.id, status: draft.receipt!.status });
    } catch { return c.json({ error: "Could not save or send feedback. Your note is still here; check host storage and try again." }, 503); }
  });
}
