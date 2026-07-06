import type { WorkspaceIntegrationMonitoring } from "@/domains/workspace/server/usage-summary";
import {
  formatUsageAuditTimestamp,
  formatUsageCount,
  formatUsageDate,
} from "./workspace-usage-formatters";

type IntegrationResourceItem = WorkspaceIntegrationMonitoring["top_resources"][number];
type IntegrationDataBoundary = WorkspaceIntegrationMonitoring["data_boundary"];

interface IntegrationMetric {
  label: string;
  value: number;
}

/**
 * Props for the workspace integration activity section.
 */
interface IntegrationMonitoringSectionProps {
  integrationMonitoring: WorkspaceIntegrationMonitoring;
}

interface IntegrationMetricsGridProps {
  metrics: IntegrationMetric[];
}

interface IntegrationResourceListProps {
  resources: IntegrationResourceItem[];
}

interface IntegrationResourceRowProps {
  resource: IntegrationResourceItem;
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
 * Build the workspace integration summary counts displayed to admins.
 *
 * @param integrationMonitoring - Workspace integration activity rollup.
 */
function buildIntegrationMetrics(
  integrationMonitoring: WorkspaceIntegrationMonitoring,
): IntegrationMetric[] {
  return [
    { label: "Total calls", value: integrationMonitoring.total_calls },
    { label: "REST API", value: integrationMonitoring.api_calls },
    { label: "MCP", value: integrationMonitoring.mcp_calls },
  ];
}

/**
 * Format the privacy boundary attached to the activity summary.
 *
 * @param dataBoundary - Boundary flags returned by the API.
 */
function formatIntegrationDataBoundary(dataBoundary: IntegrationDataBoundary): string {
  if (!dataBoundary.request_metadata_included && !dataBoundary.session_replay_included) {
    return "No request metadata or session replay";
  }

  if (!dataBoundary.request_metadata_included) {
    return "No request metadata";
  }

  if (!dataBoundary.session_replay_included) {
    return "No session replay";
  }

  return dataBoundary.statement;
}

function IntegrationMetricsGrid({ metrics }: IntegrationMetricsGridProps) {
  return (
    <dl className="border-border grid divide-y border-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {metrics.map((metric) => (
        <div className="py-3 sm:px-4 sm:first:pl-0 sm:last:pr-0" key={metric.label}>
          <dt className="type-label-small text-ink-muted uppercase">{metric.label}</dt>
          <dd className="type-title-small text-ink-strong mt-1">
            {formatUsageCount(metric.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function IntegrationResourceRow({ resource }: IntegrationResourceRowProps) {
  const lastSeenAt = formatUsageAuditTimestamp(resource.last_seen_at) ?? "Unknown time";

  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <p className="type-body-small text-ink-strong break-words">{resource.resource_id}</p>
        <p className="type-label-small text-ink-muted">
          {formatIntegrationSurface(resource.surface)}
        </p>
      </div>
      <div className="text-left sm:text-right">
        <p className="type-label-small text-ink-muted">{formatUsageCount(resource.total_calls)}</p>
        <time className="type-label-small text-ink-muted" dateTime={resource.last_seen_at}>
          {lastSeenAt}
        </time>
      </div>
    </li>
  );
}

function IntegrationResourceList({ resources }: IntegrationResourceListProps) {
  if (resources.length === 0) {
    return <p className="type-body-medium text-ink-soft">No workspace integration activity yet.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="type-label-small text-ink-muted uppercase">Most used paths</p>
      <ol className="divide-border divide-y">
        {resources.map((resource) => (
          <IntegrationResourceRow
            key={`${resource.surface}-${resource.resource_id}`}
            resource={resource}
          />
        ))}
      </ol>
    </div>
  );
}

/**
 * Customer-safe workspace integration activity summary for admins.
 */
export function IntegrationMonitoringSection({
  integrationMonitoring,
}: IntegrationMonitoringSectionProps) {
  const lastSeen = integrationMonitoring.last_seen_at
    ? formatUsageDate(integrationMonitoring.last_seen_at)
    : null;
  const boundaryLabel = formatIntegrationDataBoundary(integrationMonitoring.data_boundary);
  const metrics = buildIntegrationMetrics(integrationMonitoring);

  return (
    <section className="border-border space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="type-title-small text-ink-strong">Workspace integration activity</h3>
          {lastSeen ? (
            <p className="type-label-small text-ink-muted mt-1">Last seen {lastSeen}</p>
          ) : null}
        </div>
        <span className="type-label-small text-ink-muted uppercase">{boundaryLabel}</span>
      </div>

      <IntegrationMetricsGrid metrics={metrics} />
      <IntegrationResourceList resources={integrationMonitoring.top_resources} />
    </section>
  );
}
