/**
 * For you cards from sources: the rules' kind and facts, joined with the
 * kept digest. A source the rules could not place, or whose ask is long free
 * text, is queued for the models once; the read never waits on a model. While
 * a call is out, the card says `pending` and the page reads again shortly.
 *
 * Without a model, or after a failed call, a card is drawn from the rules
 * alone when its facts can carry it; otherwise there is no card and the row
 * stays as it is today. A card is never empty.
 */
import type { ForYouCard, ForYouDigest, ForYouFacts, ForYouKind } from "../../../shared/api/for-you.ts";
import { CLASSIFY_SYSTEM, DIGEST_SCHEMA, DIGEST_SYSTEM, classifyPrompt, classifySchema, digestPrompt, parseClassification, parseDigest } from "./digest.ts";
import { ForYouModelError, type ForYouModel, type ModelUsage } from "./model.ts";
import { factsDrawable, factsForKind, type ForYouSource } from "./source.ts";
import { FAILED_RETRY_MS, type DigestRow, type DigestStore } from "./store.ts";

/** At most this many sources wait for the models; more wait for a later read. */
const QUEUE_MAX = 12;

export type ForYouDigesterOptions = {
  model: ForYouModel | null;
  store: DigestStore;
  now?: () => number;
  /** Told once per finished call, for the log. */
  onCall?: (event: { id: string; step: "classify" | "digest"; usage?: ModelUsage; error?: string }) => void;
};

export class ForYouDigester {
  private queue: ForYouSource[] = [];
  private queued = new Set<string>();
  private running: Promise<void> | null = null;

  constructor(private readonly options: ForYouDigesterOptions) {}

  get available(): boolean {
    return Boolean(this.options.model);
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** The cards for these sources, and whether any is still being written. */
  cards(sources: readonly ForYouSource[]): { cards: ForYouCard[]; pending: boolean } {
    const cards: ForYouCard[] = [];
    let pending = false;
    for (const source of sources) {
      const card = this.card(source);
      if (this.queued.has(source.key)) pending = true;
      if (card) cards.push(card);
    }
    return { cards, pending };
  }

  private needsModel(source: ForYouSource): boolean {
    return source.rules.kind === null || source.wantsDigest;
  }

  private card(source: ForYouSource): ForYouCard | null {
    const row = this.needsModel(source) ? this.options.store.get(source.key) : null;
    const retry = row?.state === "failed" && this.now() - row.createdAt >= FAILED_RETRY_MS;
    if (this.needsModel(source) && this.options.model && (!row || retry)) this.enqueue(source);
    const waiting = this.queued.has(source.key);

    // The kind: the rules', the classifier's, or the rules' fallback.
    let kind: ForYouKind | null = source.rules.kind;
    let classifiedBy: ForYouCard["classifiedBy"] = "rules";
    if (kind === null && row?.kind) {
      kind = row.kind;
      classifiedBy = row.classifiedBy;
    }
    if (kind === null && !waiting) kind = source.rules.kind === null ? source.rules.fallback : null;
    if (kind === null) return null;

    const facts: ForYouFacts = source.rules.kind !== null ? source.rules.facts : factsForKind(kind, source);
    const digest: ForYouDigest | null = row?.state === "ready" ? row.digest : null;
    const digestState: ForYouCard["digestState"] = digest ? "ready" : waiting ? "pending" : row?.state === "failed" ? "failed" : "none";

    // Nothing to draw yet: no digest and facts too thin. The row stays as it is.
    if (!digest && !factsDrawable(facts)) return null;
    return { id: source.id, kind, classifiedBy, facts, digest, digestState, answer: source.answer };
  }

  private enqueue(source: ForYouSource): void {
    if (this.queued.has(source.key) || this.queue.length >= QUEUE_MAX) return;
    this.queued.add(source.key);
    this.queue.push(source);
    this.running ??= this.drain().finally(() => {
      this.running = null;
    });
  }

  /** Settles when the queue is empty. For tests and a one-shot run. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const source = this.queue.shift()!;
      try {
        await this.run(source);
      } finally {
        this.queued.delete(source.key);
      }
    }
  }

  private async run(source: ForYouSource): Promise<void> {
    const model = this.options.model;
    if (!model) return;
    const usage = { model: null as string | null };
    const add = (u: ModelUsage) => {
      usage.model = usage.model ? `${usage.model}+${u.model}` : u.model;
    };
    const row = (patch: Partial<DigestRow>): DigestRow => ({
      key: source.key,
      itemId: source.id,
      kind: null,
      classifiedBy: "rules",
      digest: null,
      state: "failed",
      model: usage.model,
      error: null,
      createdAt: this.now(),
      ...patch,
    });

    let kind: ForYouKind | null = source.rules.kind;
    let classifiedBy: DigestRow["classifiedBy"] = "rules";
    try {
      if (source.rules.kind === null) {
        const { candidates } = source.rules;
        const answer = await model.classify({ system: CLASSIFY_SYSTEM, prompt: classifyPrompt(source, candidates), schema: classifySchema(candidates), candidates });
        add(answer.usage);
        this.options.onCall?.({ id: source.id, step: "classify", usage: answer.usage });
        kind = parseClassification(answer.raw, candidates) ?? source.rules.fallback;
        classifiedBy = "model";
      }
      if (!kind) {
        this.options.store.put(row({ error: "The classifier gave no kind." }));
        return;
      }
      if (!source.wantsDigest) {
        this.options.store.put(row({ kind, classifiedBy, state: "ready" }));
        return;
      }
      const facts = source.rules.kind !== null ? source.rules.facts : factsForKind(kind, source);
      const answer = await model.digest({ system: DIGEST_SYSTEM, prompt: digestPrompt(source, kind, facts), schema: DIGEST_SCHEMA });
      add(answer.usage);
      this.options.onCall?.({ id: source.id, step: "digest", usage: answer.usage });
      const digest = parseDigest(answer.raw, source, kind, facts);
      this.options.store.put(row({ kind, classifiedBy, digest, state: digest ? "ready" : "failed", error: digest ? null : "The digest had no ask." }));
    } catch (error) {
      const message = error instanceof ForYouModelError ? error.message : error instanceof Error ? error.message : "The model call failed.";
      this.options.onCall?.({ id: source.id, step: kind === null ? "classify" : "digest", error: message });
      // A classified kind is kept, so the card can still be drawn from the rules.
      this.options.store.put(row({ kind, classifiedBy, error: message }));
    }
  }
}
