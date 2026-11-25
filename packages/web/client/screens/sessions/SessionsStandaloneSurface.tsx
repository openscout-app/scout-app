import { navigateBrowser, useBrowserLocation } from "../../lib/browser-location.ts";
import type { Route } from "../../lib/types.ts";
import {
  StandaloneSessionDetail,
  type StandaloneSessionLookup,
} from "../../shell/StandaloneRecordViews.tsx";
import { RawSessionsTable } from "./RawSessionsTable.tsx";

export type { StandaloneSessionLookup };

export function SessionsStandaloneSurface({
  navigate = navigateBrowser,
}: {
  navigate?: (href: string) => void;
}) {
  const { pathname } = useBrowserLocation();
  const match = /^\/sessions\/([^/]+)$/.exec(pathname);

  const handleRouteNavigate = (route: Route) => {
    if (route.view === "sessions" && route.sessionId) {
      navigate(`/sessions/${encodeURIComponent(route.sessionId)}`);
      return;
    }
    navigate("/");
  };

  if (match?.[1]) {
    return (
      <StandaloneSessionDetail
        sessionId={decodeURIComponent(match[1])}
        backLabel="Sessions"
        rail="wide"
        skeletonVariant="sessions"
        onBack={() => navigate("/")}
      />
    );
  }

  return <RawSessionsTable navigate={handleRouteNavigate} />;
}
