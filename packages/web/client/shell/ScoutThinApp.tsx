import { useCallback, useEffect, useState, type ReactNode } from "react";
import { navigateBrowser } from "../lib/browser-location.ts";
import { defaultScoutRail, type ScoutRail, type ScoutSkeletonVariant } from "./boot-html.ts";
import { ScoutAppFrame, type ScoutRuntimeBadge, type ScoutSetupCallout } from "./ScoutAppFrame.tsx";
import { StandaloneRecordRouter } from "./StandaloneRecordViews.tsx";

export interface ScoutThinStatusBase {
  runtimeUp: boolean;
  runtimeUrl: string;
}

export function useScoutThinHost<TStatus extends ScoutThinStatusBase = ScoutThinStatusBase>(options: {
  pollIntervalMs?: number;
  statusPath?: string;
  setupPath?: string;
} = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? 15_000;
  const statusPath = options.statusPath ?? "/api/status";
  const setupPath = options.setupPath ?? "/api/setup";

  const [status, setStatus] = useState<TStatus | null>(null);
  const [installing, setInstalling] = useState(false);

  const refreshStatus = useCallback(() => {
    fetch(statusPath)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setStatus(data as TStatus);
      })
      .catch(() => {});
  }, [statusPath]);

  useEffect(() => {
    refreshStatus();
    if (pollIntervalMs <= 0) return;
    const timer = setInterval(refreshStatus, pollIntervalMs);
    return () => clearInterval(timer);
  }, [pollIntervalMs, refreshStatus]);

  const runSetup = useCallback(async () => {
    setInstalling(true);
    try {
      await fetch(setupPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      refreshStatus();
    } finally {
      setInstalling(false);
    }
  }, [refreshStatus, setupPath]);

  return { status, installing, refreshStatus, runSetup };
}

export interface ScoutThinAppProps<TStatus extends ScoutThinStatusBase = ScoutThinStatusBase> {
  product: string;
  variant: ScoutSkeletonVariant;
  rail?: ScoutRail;
  navigate?: (href: string) => void;
  badge?: (status: TStatus | null) => ScoutRuntimeBadge;
  setupCallout?: (ctx: {
    status: TStatus;
    installing: boolean;
    runSetup: () => void;
    refreshStatus: () => void;
  }) => ScoutSetupCallout | null;
  headerActions?: ReactNode;
  children: ReactNode;
}

function defaultBadge(product: string, status: ScoutThinStatusBase | null): ScoutRuntimeBadge {
  if (!status) return { label: `Checking ${product}`, tone: "loading" };
  if (status.runtimeUp) return { label: "Runtime connected", tone: "ready", detail: status.runtimeUrl };
  return { label: "Local transcripts", tone: "local", detail: "Scout runtime not running" };
}

export function ScoutThinApp<TStatus extends ScoutThinStatusBase = ScoutThinStatusBase>({
  product,
  variant,
  rail = defaultScoutRail(variant),
  navigate = navigateBrowser,
  badge,
  setupCallout,
  headerActions,
  children,
}: ScoutThinAppProps<TStatus>) {
  const { status, installing, refreshStatus, runSetup } = useScoutThinHost<TStatus>();

  const resolvedBadge = badge ? badge(status) : defaultBadge(product, status);
  const resolvedCallout = status && setupCallout
    ? setupCallout({
        status,
        installing,
        runSetup: () => void runSetup(),
        refreshStatus,
      })
    : null;

  return (
    <ScoutAppFrame
      product={product}
      variant={variant}
      rail={rail}
      navigate={navigate}
      status={resolvedBadge}
      setupCallout={resolvedCallout}
      headerActions={headerActions}
    >
      <StandaloneRecordRouter product={product} rail={rail} navigate={navigate}>
        {children}
      </StandaloneRecordRouter>
    </ScoutAppFrame>
  );
}
