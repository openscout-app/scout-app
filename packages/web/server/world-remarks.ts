import { resolveJevEndpoint } from "./session-retrospective-jev.ts";
import { composeRemark, jevMomentRequest, rankRemarks, readJevGrade, ruleGrade, type MomentInput, type Remark } from "../client/screens/ops/world-week/remarks.ts";

/*
 * Prepared remarks for the World (client/screens/ops/world-week/remarks.ts has the questions and the format).
 * The HUD sends its shortlisted slots once when the week loads, then one more whenever a live bucket closes; each
 * slot is graded once per sig and kept, so a reload or the next live pass only pays for what changed. One Jev request
 * per slot, a few at a time; a slot Jev can't grade keeps the rules' grade and says so (by: "rules").
 *
 * Sending: Jev sees only the count-only state momentState() builds (no paths, names, prompts or text). The operator
 * turns it on with TYPESAFE_API_KEY; OPENSCOUT_WORLD_REMARKS=rules keeps every grade local even with a key.
 */

export type RemarksJev = { apiKey: string; endpoint: string };
export type RemarksDeps = { jev?: RemarksJev | null; fetcher?: typeof fetch; concurrency?: number; timeoutMs?: number };
export type RemarksResult = { remarks: Remark[]; graded: number; cached: number; engine: "jev" | "rules"; failed: number };

const CACHE_MAX = 4000;
const cache = new Map<string, Remark>();   // `${id}#${sig}#${engine}` → remark

export function remarksJevConfig(env: Record<string, string | undefined> = process.env): RemarksJev | null {
  if (env.OPENSCOUT_WORLD_REMARKS?.trim() === "rules") return null;
  const apiKey = env.TYPESAFE_API_KEY?.trim(), endpoint = resolveJevEndpoint(env.OPENSCOUT_JEV_ENDPOINT);
  return apiKey && endpoint ? { apiKey, endpoint } : null;
}

const num = (v: unknown, max = 1e9) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0;
const str = (v: unknown, max: number) => typeof v === "string" ? v.slice(0, max) : "";

/** A moment from the HUD, checked field by field; null when it isn't one. */
export function parseMoment(v: unknown): MomentInput | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  const id = str(m.id, 200), sig = str(m.sig, 200), laneName = str(m.laneName, 80).trim();
  const t0 = num(m.t0, 1e14), t1 = num(m.t1, 1e14);
  if (!id || !sig || !laneName || !t0 || t1 <= t0) return null;
  const kinds: Record<string, number> = {};
  if (m.kinds && typeof m.kinds === "object") for (const [k, n] of Object.entries(m.kinds).slice(0, 12)) if (/^[a-z]$/.test(k)) kinds[k] = num(n, 1e6);
  const tier = ["routine", "notable", "interesting", "must-see"].includes(m.tier as string) ? m.tier as MomentInput["tier"] : "routine";
  const before = Array.isArray(m.before) ? m.before.slice(-3).map(b => ({ calls: num(b?.calls, 1e6), lines: num(b?.lines, 1e7), errors: num(b?.errors, 1e5) })) : [];
  return {
    id, sig, laneName, t0, t1, kinds, tier, before,
    calls: num(m.calls, 1e6), edits: num(m.edits, 1e6), lines: num(m.lines, 1e7), files: num(m.files, 1e5), errors: num(m.errors, 1e5),
    coldTokens: num(m.coldTokens, 1e10), colds: num(m.colds, 1e4), rereads: num(m.rereads, 1e5), repeats: num(m.repeats, 1e5),
    score: num(m.score, 3), sessions: num(m.sessions, 1e4),
    asksOpened: num(m.asksOpened, 1e4), asksDone: num(m.asksDone, 1e4), asksFailed: num(m.asksFailed, 1e4),
  };
}

async function gradeWithJev(m: MomentInput, jev: RemarksJev, deps: RemarksDeps): Promise<Remark | null> {
  const rules = ruleGrade(m);
  try {
    const res = await (deps.fetcher ?? fetch)(jev.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${jev.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(jevMomentRequest(m)),
      redirect: "error",
      signal: AbortSignal.timeout(deps.timeoutMs ?? 8_000),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null) as { answers?: unknown } | null;
    if (!body?.answers) return null;
    return composeRemark(m, readJevGrade(body.answers, rules));
  } catch { return null; }
}

export async function prepareRemarks(input: unknown, deps: RemarksDeps = {}): Promise<RemarksResult> {
  const moments = (Array.isArray(input) ? input : []).slice(0, 48).map(parseMoment).filter((m): m is MomentInput => !!m);
  const jev = deps.jev === undefined ? remarksJevConfig() : deps.jev;
  const engine = jev ? "jev" : "rules";
  const out: Remark[] = [], todo: MomentInput[] = [];
  let cached = 0, failed = 0;
  for (const m of moments) {
    const hit = cache.get(`${m.id}#${m.sig}#${engine}`);
    if (hit) { out.push(hit); cached++; } else todo.push(m);
  }
  const keep = (m: MomentInput, r: Remark) => {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(`${m.id}#${m.sig}#${r.by}`, r); out.push(r);
  };
  if (!jev) for (const m of todo) keep(m, composeRemark(m, ruleGrade(m)));
  else {
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const m = todo[i++]!;
        const r = await gradeWithJev(m, jev, deps);
        if (r) keep(m, r);
        else { failed++; out.push(composeRemark(m, ruleGrade(m))); }   // not cached: the next pass asks Jev again
      }
    };
    await Promise.all(Array.from({ length: Math.min(deps.concurrency ?? 6, todo.length) }, worker));
  }
  return { remarks: rankRemarks(out, 12), graded: todo.length - failed, cached, engine, failed };
}

/** tests */
export function clearRemarksCache() { cache.clear(); }
