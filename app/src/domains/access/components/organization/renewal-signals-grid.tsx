import type { WorkspaceUsageSummary } from "@/domains/workspace/server/usage-summary";
import { formatUsageCount, formatUsageEventType } from "./workspace-usage-formatters";

/**
 * One renewal signal rendered in the workspace admin summary.
 */
interface RenewalSignalItem {
  key: keyof WorkspaceUsageSummary["renewal_signals"];
  label: string;
}

/**
 * Props for the renewal signal grid.
 */
interface RenewalSignalsGridProps {
  usageSummary: WorkspaceUsageSummary;
}

const RENEWAL_SIGNAL_ITEMS: RenewalSignalItem[] = [
  { key: "briefs_used", label: "Briefs used" },
  { key: "team_workflow_actions", label: "Workflow actions" },
  { key: "coverage_gaps_closed", label: "Coverage gaps closed" },
  { key: "public_records_improved", label: "Public records improved" },
  { key: "integrations_used", label: "Integrations used" },
];

/**
 * Renewal metric cards plus the raw event-count rows.
 */
export function RenewalSignalsGrid({ usageSummary }: RenewalSignalsGridProps) {
  const eventRows = Object.entries(usageSummary.event_counts).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-2">
        {RENEWAL_SIGNAL_ITEMS.map((item) => (
          <div
            className="border-border bg-surface-container-lowest rounded-[1rem] border p-3"
            key={item.key}
          >
            <dt className="type-label-small text-ink-muted uppercase">{item.label}</dt>
            <dd className="type-title-small text-ink-strong mt-1">
              {formatUsageCount(usageSummary.renewal_signals[item.key])}
            </dd>
          </div>
        ))}
      </dl>

      <div className="border-border bg-surface-container-lowest divide-border rounded-[1rem] border">
        {eventRows.map(([eventType, count]) => (
          <div className="flex items-center justify-between gap-3 px-3 py-2" key={eventType}>
            <span className="type-body-small text-ink-strong">
              {formatUsageEventType(eventType)}
            </span>
            <span className="type-label-small text-ink-muted">{formatUsageCount(count)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
