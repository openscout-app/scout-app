import { expect, test } from "bun:test";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { redactDiagnosticText, type DiagnosticOptions, type DiagnosticReport, type DiagnosticReceipt } from "@openscout/runtime/diagnostic-report";
import { mountFeedbackRoutes } from "./feedback.ts";
import { installScoutApiMiddleware } from "../server-core.ts";
import type { FeedbackPreview } from "../../shared/api/feedback.ts";
import { channelMemberMayAccess } from "../core/conversations/channel-member-session.ts";
import { MAC_HOME_ROOT } from "../../test-support/path-fixtures.ts";

function fixture() {
  let time = 1000;
  const collected: DiagnosticOptions[] = [], submitted: DiagnosticReport[] = [];
  let upload: (report: DiagnosticReport) => Promise<DiagnosticReceipt> = async report => ({ id: report.id, status: "uploaded", localPath: "/private/local/report.json" });
  const app = new Hono();
  installScoutApiMiddleware(app, "feedback-test", { authToken: "operator-token", resolvePeerAddress: () => "127.0.0.1" });
  mountFeedbackRoutes(app, {
    now: () => time,
    collect: async options => {
      collected.push(options!);
      return { id: randomUUID(), timestamp: new Date(time).toISOString(), system: { os: "darwin", osVersion: "26.6", chip: "arm64", memory: "17179869184", hostname: "PRIVATE-HOST" },
        apps: { collector: { running: true, pid: 999, version: "0.5.1" }, privateApp: { running: true, pid: 111 } },
        context: { source: "ignored", userDescription: redactDiagnosticText(options?.message ?? ""), currentDirectory: "/PRIVATE-PROJECT", reportSections: [{ id: "private", title: "Private", entries: [{ label: "secret", value: "PRIVATE-DIAGNOSTICS" }] }] }, logs: ["PRIVATE-LOG"] } as DiagnosticReport;
    },
    submit: async report => { submitted.push(report); return upload(report); },
  });
  const post = (path: string, body: unknown, authenticated = true, origin = "http://localhost") => app.request(`http://localhost/api/feedback/${path}`, { method: "POST", headers: { "content-type": "application/json", origin, ...(authenticated ? { authorization: "Bearer operator-token" } : {}) }, body: JSON.stringify(body) });
  return { post, collected, submitted, advance: () => { time += 600_001; }, upload: (fn: typeof upload) => { upload = fn; } };
}

test("preview is redacted and allowlisted; nothing is submitted until the exact draft is approved", async () => {
  const f = fixture();
  const response = await f.post("preview", { note: `api_key=verysecret ${MAC_HOME_ROOT}/alice/project feedback`, client: "macos" });
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  const preview = await response.json() as FeedbackPreview;
  expect(f.collected).toEqual([{ message: `api_key=verysecret ${MAC_HOME_ROOT}/alice/project feedback`, diagnostics: false, client: "macos" }]);
  expect(f.submitted).toHaveLength(0);
  const payload = JSON.stringify(preview.report);
  for (const forbidden of ["verysecret", "alice", "PRIVATE-", '"pid"', "privateApp", "currentDirectory"]) expect(payload).not.toContain(forbidden);
  expect(preview.report.logs).toEqual([]); expect(preview.report.context.reportSections).toEqual([]);
  const sent = await f.post("send", { token: preview.token });
  expect(await sent.json()).toEqual({ id: preview.report.id, status: "uploaded" });
  expect(f.submitted).toEqual([preview.report]);
  await f.post("send", { token: preview.token }); expect(f.submitted).toHaveLength(1);
});

test("auth, cross-origin, diagnostic injection and forged report uploads fail before collection or sending", async () => {
  const f = fixture();
  expect((await f.post("preview", { note: "note" }, false)).status).toBe(401);
  expect((await f.post("preview", { note: "note" }, true, "https://evil.example")).status).toBe(403);
  for (const body of [{ note: "" }, { note: "x".repeat(8001) }, { note: "note", diagnostics: true }, { note: "note", endpoint: "https://evil.example" }]) expect((await f.post("preview", body)).status).toBe(400);
  expect((await f.post("send", { token: randomUUID(), report: { logs: ["secret"] } })).status).toBe(400);
  expect((await f.post("send", { token: randomUUID() })).status).toBe(410);
  expect(f.collected).toHaveLength(0); expect(f.submitted).toHaveLength(0);
  const grant = { actorId: "member", displayName: "Member", channelIds: ["channel"], expiresAt: Date.now() + 60_000 };
  for (const step of ["preview", "send"]) expect(channelMemberMayAccess({ grant, method: "POST", path: `/api/feedback/${step}` })).toBe(false);
});

test("failed uploads retain the exact preview for retry; expired drafts require a new review", async () => {
  const f = fixture(); let attempts = 0;
  f.upload(async report => ({ id: report.id, status: ++attempts === 1 ? "saved" : "uploaded", localPath: "/private/report.json", error: "private internal error" }));
  const preview = await (await f.post("preview", { note: "note" })).json() as FeedbackPreview;
  const first = await f.post("send", { token: preview.token }); expect(await first.json()).toEqual({ id: preview.report.id, status: "saved" });
  const second = await f.post("send", { token: preview.token }); expect((await second.json()).status).toBe("uploaded");
  expect(f.submitted).toEqual([preview.report, preview.report]); expect(f.collected).toHaveLength(1);
  f.advance(); expect((await f.post("send", { token: preview.token })).status).toBe(410);
});

test("concurrent sends share one upload and preview storage has a fixed bound", async () => {
  const f = fixture(); let finish!: () => void;
  f.upload(report => new Promise(resolve => { finish = () => resolve({ id: report.id, status: "uploaded", localPath: "/private/report.json" }); }));
  const preview = await (await f.post("preview", { note: "note" })).json() as FeedbackPreview;
  const one = f.post("send", { token: preview.token }), two = f.post("send", { token: preview.token });
  for (let i = 0; i < 20 && !finish; i++) await Bun.sleep(1);
  expect(f.submitted).toHaveLength(1); finish(); await Promise.all([one, two]);
  for (let i = 0; i < 19; i++) expect((await f.post("preview", { note: `note ${i}` })).status).toBe(200);
  expect((await f.post("preview", { note: "overflow" })).status).toBe(429);
  f.advance(); expect((await f.post("preview", { note: "fresh" })).status).toBe(200);
});
