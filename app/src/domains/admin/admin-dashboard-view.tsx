import {
  AdminIndicatorPlaceholderCard,
  AdminIndicatorCard,
  AdminInlineStatus,
  AdminPageHeader,
  AdminPageShell,
  AdminStatusBadge,
  type AdminIndicatorTone,
} from "./admin-portal";
import type { AdminDashboardSummary } from "./admin-dashboard.functions";

interface AdminDashboardViewProps {
  errorMessage?: string;
  isLoading?: boolean;
  summary?: AdminDashboardSummary;
}

export function AdminDashboardView({
  errorMessage,
  isLoading = false,
  summary,
}: AdminDashboardViewProps) {
  const apiTone = summary?.api.status === "ok" ? "pass" : "block";
  const discoveryTone = summary && summary.discovery.failed_jobs > 0 ? "warn" : "pass";
  const costTone = summary ? postureTone(summary.cloud_costs.posture) : "neutral";

  return (
    <AdminPageShell>
      <AdminPageHeader
        badge="Operator portal"
        title="Admin"
        description="Service posture, review queues, and cost guardrails for Atlas operators."
      />

      <section className="space-y-3">
        <div className="flex flex-col gap-1">
          <h2 className="type-title-large text-ink-strong">Service health</h2>
          <p className="type-body-small text-ink-soft">
            Signals from existing runtime health, discovery pipeline, and cost guardrails.
          </p>
        </div>
        <DashboardHealthPanel
          apiTone={apiTone}
          costTone={costTone}
          discoveryTone={discoveryTone}
          errorMessage={errorMessage}
          isLoading={isLoading}
          summary={summary}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <AdminActionLink
          href="/admin/profile-claims"
          label="Review profile verifications"
          detail="Confirm representative access with source-backed evidence."
          tone="warn"
        />
        <AdminActionLink
          href="/admin/discounts"
          label="Review discounts"
          detail="Resolve submitted access discount requests."
          tone="neutral"
        />
        <AdminActionLink
          href="/admin/cloud-costs"
          label="Inspect cloud costs"
          detail="Check spend, deployment guardrails, and accounting gaps."
          tone={costTone}
        />
      </section>
    </AdminPageShell>
  );
}

function DashboardHealthPanel({
  apiTone,
  costTone,
  discoveryTone,
  errorMessage,
  isLoading,
  summary,
}: {
  apiTone: AdminIndicatorTone;
  costTone: AdminIndicatorTone;
  discoveryTone: AdminIndicatorTone;
  errorMessage?: string;
  isLoading: boolean;
  summary?: AdminDashboardSummary;
}) {
  if (errorMessage || !summary) {
    return (
      <div className="space-y-3">
        <AdminInlineStatus message={errorMessage} />
        <div className="grid gap-4 md:grid-cols-3" aria-busy={isLoading}>
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
          <AdminIndicatorPlaceholderCard label="Cloud costs" detail="Rolling discovery spend" />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
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
      <AdminIndicatorCard
        label="Cloud costs"
        value={formatCostUsage(summary)}
        detail="Rolling discovery spend"
        tone={costTone}
      />
    </div>
  );
}

function AdminActionLink({
  detail,
  href,
  label,
  tone,
}: {
  detail: string;
  href: string;
  label: string;
  tone: AdminIndicatorTone;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      className="border-border bg-surface-container-lowest hover:bg-surface-container-low block rounded-lg border p-5 no-underline transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="type-title-small text-ink-strong">{label}</h3>
        <AdminStatusBadge tone={tone}>{statusLabel(tone)}</AdminStatusBadge>
      </div>
      <p className="type-body-small text-ink-soft mt-2">{detail}</p>
    </a>
  );
}

function formatCostUsage(summary: AdminDashboardSummary) {
  return `${formatUsd(summary.cloud_costs.discovery_spend.estimated_daily_usd)} of ${formatUsd(
    summary.cloud_costs.discovery_spend.daily_ceiling_usd,
  )}`;
}

function postureTone(posture: AdminDashboardSummary["cloud_costs"]["posture"]): AdminIndicatorTone {
  if (posture === "pass") {
    return "pass";
  }
  if (posture === "warn") {
    return "warn";
  }
  return "block";
}

function statusLabel(tone: AdminIndicatorTone) {
  if (tone === "pass") {
    return "Current";
  }
  if (tone === "warn") {
    return "Review";
  }
  if (tone === "block") {
    return "Blocked";
  }
  return "Open";
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}
