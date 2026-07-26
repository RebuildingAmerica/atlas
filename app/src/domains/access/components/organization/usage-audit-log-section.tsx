import type {
  WorkspaceUsageAuditLog,
  WorkspaceUsageEvent,
} from "@/domains/workspace/server/usage-summary";
import {
  formatDateTimeOrNull,
  useDateTimeFormatter,
  MEDIUM_DATE_TIME,
} from "@rebuildingamerica/atlas-ui/format/date-time";
import { formatUsageEventType } from "./workspace-usage-formatters";

/**
 * Props for the workspace usage audit log section.
 */
interface UsageAuditLogSectionProps {
  auditLog: WorkspaceUsageAuditLog;
}

/**
 * Return the safest useful resource label for an audit-log row.
 *
 * @param event - Customer-safe usage event.
 */
function formatAuditResource(event: WorkspaceUsageEvent): string {
  if (event.resource_id) {
    return event.resource_id;
  }

  if (event.resource_type) {
    return formatUsageEventType(event.resource_type);
  }

  return "Workspace";
}

/**
 * Customer-safe access log for workspace usage events.
 */
export function UsageAuditLogSection({ auditLog }: UsageAuditLogSectionProps) {
  const formatDateTime = useDateTimeFormatter();
  return (
    <section className="border-border space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="type-title-small text-ink-strong">Access log</h3>
        <span className="type-label-small text-ink-muted uppercase">Private metadata excluded</span>
      </div>

      {auditLog.items.length === 0 ? (
        <p className="type-body-medium text-ink-soft">No access-log events yet.</p>
      ) : (
        <ol className="divide-border divide-y">
          {auditLog.items.map((event) => {
            const timestamp =
              formatDateTimeOrNull(formatDateTime, event.created_at, MEDIUM_DATE_TIME) ??
              "Unknown time";
            return (
              <li className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto]" key={event.id}>
                <div className="min-w-0">
                  <p className="type-body-small text-ink-strong">
                    {formatUsageEventType(event.event_type)}
                  </p>
                  <p className="type-label-small text-ink-muted truncate">
                    {formatAuditResource(event)}
                  </p>
                </div>
                <time
                  className="type-label-small text-ink-muted sm:text-right"
                  dateTime={event.created_at}
                >
                  {timestamp}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
