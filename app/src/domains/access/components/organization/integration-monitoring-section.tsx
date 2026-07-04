import type { WorkspaceIntegrationMonitoring } from "@/domains/workspace/server/usage-summary";
import {
  formatUsageAuditTimestamp,
  formatUsageCount,
  formatUsageDate,
} from "./workspace-usage-formatters";

type IntegrationResourceItem = WorkspaceIntegrationMonitoring["top_resources"][number];

/**
 * Props for the integration monitoring section.
 */
interface IntegrationMonitoringSectionProps {
  integrationMonitoring: WorkspaceIntegrationMonitoring;
}

/**
 * Convert integration surfaces into admin-facing labels.
 *
 * @param surface - Integration surface key from the API.
 */
function formatIntegrationSurface(surface: IntegrationResourceItem["surface"]): string {
  if (surface === "mcp") {
    return "MCP";
  }

  return "REST API";
}

/**
 * Customer-safe API/MCP activity summary for workspace admins.
 */
export function IntegrationMonitoringSection({
  integrationMonitoring,
}: IntegrationMonitoringSectionProps) {
  const lastSeen = integrationMonitoring.last_seen_at
    ? formatUsageDate(integrationMonitoring.last_seen_at)
    : null;

  return (
    <section className="border-border space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="type-title-small text-ink-strong">Integration monitoring</h3>
          {lastSeen ? (
            <p className="type-label-small text-ink-muted mt-1">Last seen {lastSeen}</p>
          ) : null}
        </div>
        <span className="type-label-small text-ink-muted uppercase">Request metadata excluded</span>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="border-border bg-surface-container-lowest rounded-[1rem] border p-3">
          <dt className="type-label-small text-ink-muted uppercase">Total calls</dt>
          <dd className="type-title-small text-ink-strong mt-1">
            {formatUsageCount(integrationMonitoring.total_calls)}
          </dd>
        </div>
        <div className="border-border bg-surface-container-lowest rounded-[1rem] border p-3">
          <dt className="type-label-small text-ink-muted uppercase">REST API</dt>
          <dd className="type-title-small text-ink-strong mt-1">
            {formatUsageCount(integrationMonitoring.api_calls)}
          </dd>
        </div>
        <div className="border-border bg-surface-container-lowest rounded-[1rem] border p-3">
          <dt className="type-label-small text-ink-muted uppercase">MCP</dt>
          <dd className="type-title-small text-ink-strong mt-1">
            {formatUsageCount(integrationMonitoring.mcp_calls)}
          </dd>
        </div>
      </dl>

      {integrationMonitoring.top_resources.length === 0 ? (
        <p className="type-body-medium text-ink-soft">No integration events yet.</p>
      ) : (
        <ol className="divide-border divide-y">
          {integrationMonitoring.top_resources.map((resource) => {
            const lastSeenAt = formatUsageAuditTimestamp(resource.last_seen_at) ?? "Unknown time";
            return (
              <li
                className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                key={`${resource.surface}-${resource.resource_id}`}
              >
                <div className="min-w-0">
                  <p className="type-body-small text-ink-strong">{resource.resource_id}</p>
                  <p className="type-label-small text-ink-muted">
                    {formatIntegrationSurface(resource.surface)}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="type-label-small text-ink-muted">
                    {formatUsageCount(resource.total_calls)}
                  </p>
                  <time
                    className="type-label-small text-ink-muted"
                    dateTime={resource.last_seen_at}
                  >
                    {lastSeenAt}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
