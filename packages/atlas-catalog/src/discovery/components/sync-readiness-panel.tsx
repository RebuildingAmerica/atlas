import { ClipboardList, FileJson, Newspaper, Users } from "lucide-react";
import type { DiscoveryRun } from "@rebuildingamerica/atlas-api-client";

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

interface SyncReadinessPanelProps {
  run: DiscoveryRun;
}

interface SyncReadinessItem {
  icon: typeof Users;
  label: string;
}

export function SyncReadinessPanel({ run }: SyncReadinessPanelProps) {
  const summary = run.research_summary;
  if (!summary) {
    return null;
  }

  const leadCount = summary.ranked_leads.length;
  const sourceCount = summary.key_sources.length;
  const hasFollowUpContext = summary.gaps.length > 0 || summary.reasoning_signals.length > 0;
  const items: SyncReadinessItem[] = [
    {
      icon: Users,
      label: `${pluralize(leadCount, "lead", "leads")} with source context`,
    },
    {
      icon: Newspaper,
      label: `${pluralize(sourceCount, "key source", "key sources")} attached`,
    },
    {
      icon: ClipboardList,
      label: hasFollowUpContext ? "Notes and follow-up context included" : "Lead context ready",
    },
    {
      icon: FileJson,
      label: "CSV, JSON, and brief exports available",
    },
  ];

  return (
    <section
      aria-label="Sync readiness"
      className="border-border bg-surface-container-lowest space-y-3 rounded-xl border p-4"
    >
      <div className="space-y-1">
        <p className="type-label-large text-ink-muted">Sync readiness</p>
        <p className="type-title-small text-ink-strong">Ready for CRM or newsroom handoff</p>
        <p className="type-body-small text-ink-soft">
          Use these fields when moving vetted leads into another workspace.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="border-border bg-surface flex items-center gap-2 rounded-lg border px-3 py-2"
            >
              <Icon className="text-accent h-4 w-4" aria-hidden />
              <p className="type-body-small text-ink-strong">{item.label}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
