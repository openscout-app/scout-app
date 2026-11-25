import type { DiagnosticReport } from "@openscout/runtime/diagnostic-report";

export type FeedbackPreview = { token: string; expiresAt: number; report: DiagnosticReport };
export type FeedbackResult = { id: string; status: "uploaded" | "saved" };
