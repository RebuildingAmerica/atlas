import {
  AdminIndicatorPlaceholderCard,
  AdminIndicatorCard,
  AdminInlineStatus,
  AdminPageHeader,
  AdminPageShell,
  AdminStatusBadge,
  type AdminIndicatorTone,
} from "@rebuildingamerica/atlas-ui/layout/admin-portal";
import type { AdminDashboardSummary } from "./admin-dashboard.functions";

interface AdminDashboardViewProps {
  showWaitlist?: boolean;
  errorMessage?: string;
  isLoading?: boolean;
  summary?: AdminDashboardSummary;
}

interface DashboardHealthPanelProps {
  apiTone: AdminIndicatorTone;
  discoveryTone: AdminIndicatorTone;
  errorMessage?: string;
  isLoading: boolean;
  summary?: AdminDashboardSummary;
}

interface AdminActionLinkProps {
  detail: string;
  href: string;
  label: string;
}

/**
 * The instance operator's start page: this instance's health and its
 * editorial queues. Platform work (discounts, cloud costs) happens in the
 * Atlas platform admin, not here.
 */
export function AdminDashboardView({
  showWaitlist = false,
  errorMessage,
  isLoading = false,
  summary,
}: AdminDashboardViewProps) {
  const apiTone = summary?.api.status === "ok" ? "pass" : "block";
  const discoveryTone = summary && summary.discovery.failed_jobs > 0 ? "warn" : "pass";

  return (
    <AdminPageShell>
      <AdminPageHeader
        badge="Operator portal"
        title="Admin"
        description="Service health and editorial review queues for this Atlas instance."
      />

      <section className="space-y-3">
        <div className="flex flex-col gap-1">
          <h2 className="type-title-large text-ink-strong">Service health</h2>
          <p className="type-body-small text-ink-soft">
            Signals from the API's runtime health and the discovery pipeline.
          </p>
        </div>
        <DashboardHealthPanel
          apiTone={apiTone}
          discoveryTone={discoveryTone}
          errorMessage={errorMessage}
          isLoading={isLoading}
          summary={summary}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {showWaitlist ? (
          <AdminActionLink
            href="/admin/waitlist"
            label="Review paid access waitlist"
            detail="Review requests, invite people, and follow their signup."
          />
        ) : null}
        <AdminActionLink
          href="/admin/corrections"
          label="Review visitor corrections"
          detail="Read private profile and source reports, correct public facts, and close resolved concerns."
        />
        <AdminActionLink
          href="/admin/discovery-reviews"
          label="Review discovered profiles"
          detail="Check proposed public facts against their sources before publishing."
        />
        <AdminActionLink
          href="/admin/profile-claims"
          label="Review profile verifications"
          detail="Confirm representative access with source-backed evidence."
        />
      </section>
    </AdminPageShell>
  );
}

function DashboardHealthPanel({
  apiTone,
  discoveryTone,
  errorMessage,
  isLoading,
  summary,
}: DashboardHealthPanelProps) {
  if (errorMessage || !summary) {
    return (
      <div className="space-y-3">
        <AdminInlineStatus message={errorMessage} />
        <div className="grid gap-4 md:grid-cols-2" aria-busy={isLoading}>
          <AdminIndicatorPlaceholderCard label="API" detail="Runtime health endpoint" />
          <AdminIndicatorPlaceholderCard
            label="Discovery pipeline"
            detail={
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                <span>- queued</span>
                <span>- failed</span>
              </span>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <AdminIndicatorCard
        label="API"
        value={summary.api.status === "ok" ? "Healthy" : "Degraded"}
        detail="Runtime health endpoint"
        tone={apiTone}
      />
      <AdminIndicatorCard
        label="Discovery pipeline"
        value={`${summary.discovery.running_jobs} running`}
        detail={
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            <span>{summary.discovery.queued_jobs} queued</span>
            <span>{summary.discovery.failed_jobs} failed</span>
          </span>
        }
        tone={discoveryTone}
      />
    </div>
  );
}

/** A link to one editorial review queue. */
function AdminActionLink({ detail, href, label }: AdminActionLinkProps) {
  return (
    <a
      href={href}
      aria-label={label}
      className="border-border bg-surface-container-lowest hover:bg-surface-container-low block rounded-lg border p-5 no-underline transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="type-title-small text-ink-strong">{label}</h3>
        <AdminStatusBadge tone="warn">Review</AdminStatusBadge>
      </div>
      <p className="type-body-small text-ink-soft mt-2">{detail}</p>
    </a>
  );
}
