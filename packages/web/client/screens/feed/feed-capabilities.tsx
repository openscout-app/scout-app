import { createContext, useContext, useMemo, type ReactNode } from "react";
import { readOnlyPreview } from "../../lib/preview-capabilities.ts";

export type FeedCapabilities = {
  /** Use recorded navigation and polling instead of write controls and live subscriptions. */
  readOnly: boolean;
  /** Link shown at the foot of a read-only standalone stream. Use null to hide it. */
  handoff?: { label: string; href: string; detail?: string } | null;
};

export const defaultFeedHandoff = {
  label: "Get Scout ↗",
  href: "https://openscout.app",
  detail: "Read-only Feed preview. Reply to agents, steer decisions, and inspect live sessions in Scout.",
} as const;

const FeedCapabilitiesContext = createContext<FeedCapabilities>({
  readOnly: readOnlyPreview,
  handoff: defaultFeedHandoff,
});

export function useFeedCapabilities(): FeedCapabilities {
  return useContext(FeedCapabilitiesContext);
}

/** Override only the fields supplied; other capabilities come from the parent. */
export function FeedCapabilitiesProvider({ capabilities, children }: {
  capabilities?: Partial<FeedCapabilities>;
  children: ReactNode;
}) {
  const inherited = useFeedCapabilities();
  const readOnly = capabilities?.readOnly ?? inherited.readOnly;
  const handoff = capabilities?.handoff === undefined ? inherited.handoff : capabilities.handoff;
  const value = useMemo(() => ({ readOnly, handoff }), [readOnly, handoff]);
  return <FeedCapabilitiesContext.Provider value={value}>{children}</FeedCapabilitiesContext.Provider>;
}
