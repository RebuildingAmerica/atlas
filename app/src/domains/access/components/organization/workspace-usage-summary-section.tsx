import { Download } from "lucide-react";
import type {
  WorkspaceIntegrationMonitoring,
  WorkspaceUsageAuditLog,
  WorkspaceUsageSummary,
} from "@/domains/workspace/server/usage-summary";
import { IntegrationMonitoringSection } from "./integration-monitoring-section";
import { RenewalSignalsGrid } from "./renewal-signals-grid";
import { UsageAuditLogSection } from "./usage-audit-log-section";
import { formatUsageCount } from "./workspace-usage-formatters";

/**
 * Props for the workspace usage-summary section.
 */
interface WorkspaceUsageSummarySectionProps {
  auditLog?: WorkspaceUsageAuditLog;
  integrationMonitoring?: WorkspaceIntegrationMonitoring;
  renewalPacketUrl: string;
  usageSummary: WorkspaceUsageSummary;
}

/**
 * Workspace admin card for non-invasive renewal usage proof.
 */
export function WorkspaceUsageSummarySection({
  auditLog,
  integrationMonitoring,
  renewalPacketUrl,
  usageSummary,
}: WorkspaceUsageSummarySectionProps) {
  return (
    <article className="border-border bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="space-y-2">
            <h2 className="type-title-large text-ink-strong">Renewal proof</h2>
            <p className="type-body-medium text-ink-soft">Customer-visible outcomes</p>
          </div>
          <a
            className="border-border text-ink-strong hover:bg-surface-container-lowest inline-flex items-center gap-2 rounded-full border px-3 py-2 transition-colors"
            download
            href={renewalPacketUrl}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span className="type-label-medium">Download packet</span>
          </a>
        </div>
        <div className="border-border bg-surface-container-lowest min-w-24 rounded-[1rem] border px-4 py-3 text-right">
          <p className="type-label-small text-ink-muted uppercase">Events</p>
          <p className="type-title-large text-ink-strong mt-1">
            {formatUsageCount(usageSummary.total_events)}
          </p>
        </div>
      </div>

      {usageSummary.total_events === 0 ? (
        <p className="type-body-medium text-ink-soft">No renewal events yet.</p>
      ) : (
        <RenewalSignalsGrid usageSummary={usageSummary} />
      )}

      {auditLog ? <UsageAuditLogSection auditLog={auditLog} /> : null}

      {integrationMonitoring ? (
        <IntegrationMonitoringSection integrationMonitoring={integrationMonitoring} />
      ) : null}
    </article>
  );
}
