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
import { EditorialTriageDesk } from "./editorial-triage-desk";
import type { EditorialTriage } from "./editorial-triage.functions";

interface AdminDashboardViewProps {
  errorMessage?: string;
  isLoading?: boolean;
  /** The current time in milliseconds, for how long queued work has waited. */
  now: number;
  summary?: AdminDashboardSummary;
  triage?: EditorialTriage;
  triageError?: string;
}

interface DashboardHealthPanelProps {
  apiTone: AdminIndicatorTone;
  discoveryTone: AdminIndicatorTone;
  errorMessage?: string;
  isLoading: boolean;
  summary?: AdminDashboardSummary;
}

interface AdminActionLinkProps {
  /** The badge naming what the operator does there. */
  action: string;
  detail: string;
  href: string;
  label: string;
}

/**
 * The instance operator's start page: this instance's health, what is
 * waiting in its review queues, and its editorial tools. Platform work
 * (discounts, cloud costs) happens in the Atlas platform admin, not here.
 */
export function AdminDashboardView({
  errorMessage,
  isLoading = false,
  now,
  summary,
  triage,
  triageError,
}: AdminDashboardViewProps) {
  const apiTone = summary?.api.status === "ok" ? "pass" : "block";
  const discoveryTone = summary && summary.discovery.failed_jobs > 0 ? "warn" : "pass";

  return (
    <AdminPageShell>
      <AdminPageHeader
        badge="Instance operator"
        title="Editorial"
        description="Service health, review queues and discovery schedules for this Atlas instance."
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

      <EditorialTriageDesk errorMessage={triageError} now={now} triage={triage} />

      <section aria-label="Editorial tools" className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <AdminActionLink
          action="Manage"
          href="/editorial/takedowns"
          label="Take down a profile"
          detail="Hide a profile when the person asks, and keep it hidden until you restore it."
        />
        <AdminActionLink
          action="Manage"
          href="/editorial/merges"
          label="Merge duplicate profiles"
          detail="Fold a profile Atlas listed twice into the one to keep, with its sources and followers."
        />
        <AdminActionLink
          action="Manage"
          href="/editorial/schedules"
          label="Manage discovery schedules"
          detail="Choose which places and issues Atlas re-researches every night, and pause or remove them."
        />
        <AdminActionLink
          action="Read"
          href="/editorial/activity"
          label="Editorial activity"
          detail="See every editorial change on this instance, who made it and when, including refused attempts."
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

/** A link to one editorial tool. */
function AdminActionLink({ action, detail, href, label }: AdminActionLinkProps) {
  return (
    <a
      href={href}
      aria-label={label}
      className="border-border bg-surface-container-lowest hover:bg-surface-container-low block rounded-lg border p-5 no-underline transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="type-title-small text-ink-strong">{label}</h3>
        <AdminStatusBadge tone="warn">{action}</AdminStatusBadge>
      </div>
      <p className="type-body-small text-ink-soft mt-2">{detail}</p>
    </a>
  );
}
