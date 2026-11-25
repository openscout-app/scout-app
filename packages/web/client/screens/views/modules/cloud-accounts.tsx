/**
 * Accounts and integrations — hosting, agent compute, code and chat.
 *
 * Shows:  one line per account (Cloudflare, Vercel, Fly.io and other hosting
 *         CLIs, exe.dev, GitHub) and per runtime integration (Slack): what
 *         it is, its status, and its dashboard.
 * Data:   the shared Providers loop (harnesses/use-service-budgets.ts), the
 *         same read as Subscriptions; integrations come from the runtime's
 *         /v1/integrations/setup list.
 * Scope:  none.
 * Opens:  each account's dashboard (new tab).
 */
import { CloudAccountsSection } from "../../harnesses/HarnessesScreen.tsx";
import { useServiceBudgets } from "../../harnesses/use-service-budgets.ts";
import { defineModule } from "./contract.ts";
import { Quiet } from "./shared.tsx";
import "./providers-panels.css";

function CloudAccounts() {
  const { cloudAccounts, loading } = useServiceBudgets({ fresh: true });
  if (!loading && cloudAccounts.length === 0) return <Quiet>No accounts or integrations found on this host.</Quiet>;
  return (
    <div className="vw-hs">
      <CloudAccountsSection accounts={cloudAccounts} loading={loading} />
    </div>
  );
}

export const cloudAccountsModule = defineModule({
  type: "cloud-accounts",
  title: "Accounts and integrations",
  blurb: "Hosting, agent compute, code and chat accounts",
  docs: {
    shows: "One line per account or integration: kind, status, dashboard link.",
    data: "The shared Providers loop (the Subscriptions read), including the runtime's integration list.",
    opens: "Each account's dashboard (new tab).",
  },
  fit: true,
  size: { w: 4, h: 12 },
  minSize: { w: 3, h: 6 },
  Component: CloudAccounts,
});
