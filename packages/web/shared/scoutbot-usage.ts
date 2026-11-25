import type { VoiceModelUsage } from "./voice-usage.ts";

/**
 * What Scoutbot's recorded model requests add up to: by window, by day and by
 * kind of request. It only sums what the usage store holds. A request whose
 * provider reported no tokens is counted as a request and as "unreported",
 * never estimated.
 */

export type ScoutbotUsageTotals = {
  /** Every attempt, whatever came of it. */
  requests: number;
  failed: number;
  /** Completed requests whose provider reported tokens. */
  reported: number;
  /** Completed requests with no token report. */
  unreported: number;
  tokensIn: number;
  tokensOut: number;
  tokens: number;
};

export type ScoutbotUsageDay = ScoutbotUsageTotals & {
  /** Local midnight the day starts on. */
  start: number;
};

export type ScoutbotUsageKind = ScoutbotUsageTotals & {
  mode: string;
  /** The median reported request of this kind; null before the first report. */
  typicalTokens: number | null;
  typicalIn: number | null;
  typicalOut: number | null;
  lastAt: number | null;
};

export type ScoutbotUsageSummary = {
  today: ScoutbotUsageTotals;
  week: ScoutbotUsageTotals;
  window: ScoutbotUsageTotals;
  /** One entry per local day, oldest first, ending today. */
  days: ScoutbotUsageDay[];
  /** Kinds that have at least one request in the window, busiest first. */
  kinds: ScoutbotUsageKind[];
};

function emptyTotals(): ScoutbotUsageTotals {
  return { requests: 0, failed: 0, reported: 0, unreported: 0, tokensIn: 0, tokensOut: 0, tokens: 0 };
}

/** The tokens a request used, when its provider said. */
export function scoutbotRequestTokens(record: VoiceModelUsage): number | null {
  if (record.totalTokens !== null) return record.totalTokens;
  if (record.inputTokens !== null || record.outputTokens !== null) {
    return (record.inputTokens ?? 0) + (record.outputTokens ?? 0);
  }
  return null;
}

/**
 * The input a request sent. A total is input plus output, so where both the
 * total and the output were reported the input is their difference. That also
 * reads rows recorded before cached input was counted as input.
 */
export function scoutbotRequestInput(record: VoiceModelUsage): number | null {
  if (record.totalTokens !== null && record.outputTokens !== null && record.totalTokens >= record.outputTokens) {
    return record.totalTokens - record.outputTokens;
  }
  return record.inputTokens;
}

function add(totals: ScoutbotUsageTotals, record: VoiceModelUsage): void {
  totals.requests += 1;
  if (record.state === "failed") {
    totals.failed += 1;
    return;
  }
  if (record.state !== "completed") return;
  const tokens = scoutbotRequestTokens(record);
  if (tokens === null) {
    totals.unreported += 1;
    return;
  }
  totals.reported += 1;
  totals.tokens += tokens;
  totals.tokensIn += scoutbotRequestInput(record) ?? 0;
  totals.tokensOut += record.outputTokens ?? 0;
}

function localDayStart(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

export function summarizeScoutbotUsage(
  records: readonly VoiceModelUsage[],
  now: number,
  dayCount = 30,
): ScoutbotUsageSummary {
  const todayStart = localDayStart(now);
  const days: ScoutbotUsageDay[] = [];
  for (let back = dayCount - 1; back >= 0; back -= 1) {
    // Calendar steps, so a clock change does not shift a day's edge.
    const day = new Date(todayStart);
    day.setDate(day.getDate() - back);
    days.push({ start: day.getTime(), ...emptyTotals() });
  }
  const windowStart = days[0]?.start ?? todayStart;
  const weekStart = days[Math.max(0, days.length - 7)]?.start ?? todayStart;

  const today = emptyTotals();
  const week = emptyTotals();
  const window = emptyTotals();
  const byKind = new Map<string, { totals: ScoutbotUsageTotals; tokens: number[]; ins: number[]; outs: number[]; lastAt: number | null }>();

  for (const record of records) {
    if (record.startedAt < windowStart) continue;
    add(window, record);
    if (record.startedAt >= weekStart) add(week, record);
    if (record.startedAt >= todayStart) add(today, record);
    const dayStart = localDayStart(record.startedAt);
    const day = days.find((entry) => entry.start === dayStart);
    if (day) add(day, record);

    let kind = byKind.get(record.mode);
    if (!kind) {
      kind = { totals: emptyTotals(), tokens: [], ins: [], outs: [], lastAt: null };
      byKind.set(record.mode, kind);
    }
    add(kind.totals, record);
    kind.lastAt = Math.max(kind.lastAt ?? 0, record.startedAt);
    const tokens = record.state === "completed" ? scoutbotRequestTokens(record) : null;
    if (tokens !== null) {
      kind.tokens.push(tokens);
      const sent = scoutbotRequestInput(record);
      if (sent !== null) kind.ins.push(sent);
      if (record.outputTokens !== null) kind.outs.push(record.outputTokens);
    }
  }

  const kinds = [...byKind.entries()]
    .map(([mode, kind]) => ({
      mode,
      ...kind.totals,
      typicalTokens: median(kind.tokens),
      typicalIn: median(kind.ins),
      typicalOut: median(kind.outs),
      lastAt: kind.lastAt,
    }))
    .sort((a, b) => b.tokens - a.tokens || b.requests - a.requests);

  return { today, week, window, days, kinds };
}

/**
 * Every occasion Scoutbot asks a model for something, in the order an operator
 * meets them. `mode` is how the usage store labels the request. `unprompted`
 * marks the one that runs without the operator asking.
 */
export type ScoutbotUsageOccasion = {
  mode: string;
  label: string;
  when: string;
  carries: string;
  unprompted?: boolean;
};

export const SCOUTBOT_USAGE_OCCASIONS: readonly ScoutbotUsageOccasion[] = [
  {
    mode: "chat",
    label: "Typed message",
    when: "Each message you send Scoutbot.",
    carries: "Your words, the instructions and the full snapshot of Scout's state.",
  },
  {
    mode: "local",
    label: "Spoken reply",
    when: "Each thing you say to Scoutbot with voice on this host.",
    carries: "Your words, the last few turns and a shorter snapshot.",
  },
  {
    mode: "api",
    label: "Question from a live call",
    when: "When a live call hands Scoutbot a question.",
    carries: "The question, the instructions and the full snapshot.",
  },
  {
    mode: "recap",
    label: "Session recap",
    when: "Fleet roll call and Speak latest turn, from the command palette. One request for each session shown.",
    carries: "That session's latest events. No snapshot.",
  },
  {
    mode: "brief",
    label: "Briefing",
    when: "When a briefing is asked for. Two requests: one writes it, one shapes it for speech.",
    carries: "The full snapshot, then the briefing's own text.",
  },
  {
    mode: "advice",
    label: "Note on provider limits",
    when: "At most once every two hours, while a page that shows provider limits is open.",
    carries: "The limit gauges. No snapshot.",
    unprompted: true,
  },
];

export function scoutbotUsageLabel(mode: string): string {
  return SCOUTBOT_USAGE_OCCASIONS.find((occasion) => occasion.mode === mode)?.label ?? mode;
}

/**
 * What Scoutbot is told about its own recorded use, so it can answer in
 * conversation. Small on purpose: three windows and one line per kind.
 */
export type ScoutbotUsageBrief = {
  about: string;
  /** Set when older requests in the window were left out, so the sums are low. */
  partial?: string;
  today: ScoutbotUsageBriefWindow;
  last7Days: ScoutbotUsageBriefWindow;
  last30Days: ScoutbotUsageBriefWindow;
  byKind: { kind: string; requests: number; typicalTokens: number | null; typicalIn: number | null; typicalOut: number | null }[];
};

export type ScoutbotUsageBriefWindow = {
  requests: number;
  tokens: number;
  tokensIn: number;
  tokensOut: number;
  noTokenReport: number;
  failed: number;
};

function briefWindow(totals: ScoutbotUsageTotals): ScoutbotUsageBriefWindow {
  return {
    requests: totals.requests,
    tokens: totals.tokens,
    tokensIn: totals.tokensIn,
    tokensOut: totals.tokensOut,
    noTokenReport: totals.unreported,
    failed: totals.failed,
  };
}

export function briefScoutbotUsage(
  records: readonly VoiceModelUsage[],
  now: number,
  options: { truncated?: boolean } = {},
): ScoutbotUsageBrief {
  const summary = summarizeScoutbotUsage(records, now);
  return {
    about: "Model requests Scoutbot made on this host, as recorded. A reply through Codex reports no tokens, so it counts as a request and adds no tokens. Replies made by Scoutbot's own chat process are not recorded. Settings, Scoutbot shows each request.",
    ...(options.truncated
      ? { partial: "Only the most recent requests in the last 30 days are counted here, so the 30-day and by-kind figures are lower than the real ones. Say so when you give them." }
      : {}),
    today: briefWindow(summary.today),
    last7Days: briefWindow(summary.week),
    last30Days: briefWindow(summary.window),
    byKind: summary.kinds.map((kind) => ({
      kind: scoutbotUsageLabel(kind.mode),
      requests: kind.requests,
      typicalTokens: kind.typicalTokens,
      typicalIn: kind.typicalIn,
      typicalOut: kind.typicalOut,
    })),
  };
}

/** The snapshot's parts, named as the app names them. */
const SCOUTBOT_SNAPSHOT_PARTS: Record<string, string> = {
  build: "This build",
  agents: "Agents",
  fleet: "Asks and what is waiting",
  operatorAttention: "Open requests",
  broker: "Runtime diagnostics",
  activeWork: "Work items",
  activeRuns: "Runs",
  activeFlights: "Flights",
  sessions: "Sessions",
  recentMessages: "Recent messages",
  recentActivity: "Recent activity",
  briefingEvidence: "Evidence for briefings",
  heartrate: "Activity rate",
  mesh: "Hosts",
  harnessActivity: "Harness processes and transcripts",
  reminders: "Reminders",
  scoutbotUsage: "Scoutbot's own usage",
};

export function scoutbotSnapshotPartLabel(key: string): string {
  return SCOUTBOT_SNAPSHOT_PARTS[key] ?? key;
}

/** A part's share of the whole as a whole percent; under one reads "<1%". */
export function formatShare(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return "0%";
  const percent = (part / whole) * 100;
  return percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

/** A window in one line: requests, then tokens each way, then what is missing from them. */
export function scoutbotTotalsLine(totals: ScoutbotUsageTotals): string {
  if (totals.requests === 0) return "No requests.";
  const parts = [`${totals.requests.toLocaleString()} ${totals.requests === 1 ? "request" : "requests"}`];
  if (totals.reported > 0) parts.push(`${formatTokenCount(totals.tokensIn)} in, ${formatTokenCount(totals.tokensOut)} out`);
  if (totals.unreported > 0) parts.push(`${totals.unreported.toLocaleString()} with no token report`);
  if (totals.failed > 0) parts.push(`${totals.failed.toLocaleString()} failed`);
  return `${parts.join(". ")}.`;
}

/** 812, 48.4k, 1.2M: short enough for a row, never rounded up a unit. */
export function formatTokenCount(value: number): string {
  if (value < 1000) return String(Math.round(value));
  if (value < 999_500) {
    const thousands = value / 1000;
    return `${thousands < 100 ? thousands.toFixed(1).replace(/\.0$/, "") : Math.round(thousands)}k`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
