export const SCOUTBOT_GUIDE_TOPICS = { app: true, product: true, native: true, protocol: true, routing: true, attention: true } as const;

export type ScoutbotGuideTopic = keyof typeof SCOUTBOT_GUIDE_TOPICS;

/** A bounded, on-demand read of maintained docs; no model context is spent before the call. */
export async function readScoutbotGuide(topic: ScoutbotGuideTopic): Promise<string> {
  return `The optional ${topic} guide is not installed in this local build.`;
}
