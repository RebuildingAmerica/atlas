import type { FeedItemRowData } from "@/domains/catalog/components/feed/feed-item-row";

interface ChangeClassificationSectionProps {
  /** Feed rows to classify for the monitoring digest. */
  items: FeedItemRowData[];
  /** Reference date for deterministic freshness windows. */
  now?: Date;
}

interface ActorSignalGroup {
  entryId: string;
  entryName: string;
  sourceCount: number;
  latestIngestedAt: number;
}

interface ChangeClassification {
  entryId: string;
  label: "Source attention shift" | "Recent source signal" | "Freshness review";
  description: string;
  priority: number;
  latestIngestedAt: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function sourceCountLabel(count: number): string {
  return `${count} ${count === 1 ? "new source" : "new sources"}`;
}

function groupActorSignals(items: FeedItemRowData[]): ActorSignalGroup[] {
  const groups = new Map<string, ActorSignalGroup>();
  for (const item of items) {
    const ingestedAt = Date.parse(item.ingested_at);
    if (Number.isNaN(ingestedAt)) continue;
    const current = groups.get(item.entry_id);
    if (current) {
      current.sourceCount += 1;
      current.latestIngestedAt = Math.max(current.latestIngestedAt, ingestedAt);
    } else {
      groups.set(item.entry_id, {
        entryId: item.entry_id,
        entryName: item.entry_name,
        sourceCount: 1,
        latestIngestedAt: ingestedAt,
      });
    }
  }
  return [...groups.values()];
}

function classifyActorSignal(group: ActorSignalGroup, nowMs: number): ChangeClassification | null {
  const ageMs = nowMs - group.latestIngestedAt;
  if (group.sourceCount > 1 && ageMs <= WEEK_MS) {
    return {
      entryId: group.entryId,
      label: "Source attention shift",
      description: `${group.entryName} appeared in ${sourceCountLabel(group.sourceCount)}.`,
      priority: 0,
      latestIngestedAt: group.latestIngestedAt,
    };
  }
  if (ageMs <= WEEK_MS) {
    return {
      entryId: group.entryId,
      label: "Recent source signal",
      description: `${group.entryName} has a new source this week.`,
      priority: 1,
      latestIngestedAt: group.latestIngestedAt,
    };
  }
  if (ageMs > MONTH_MS) {
    return {
      entryId: group.entryId,
      label: "Freshness review",
      description: `${group.entryName} has no source signal this month.`,
      priority: 2,
      latestIngestedAt: group.latestIngestedAt,
    };
  }
  return null;
}

export function buildChangeClassifications(
  items: FeedItemRowData[],
  now = new Date(),
): ChangeClassification[] {
  return groupActorSignals(items)
    .map((group) => classifyActorSignal(group, now.getTime()))
    .filter((classification): classification is ChangeClassification => classification !== null)
    .sort((a, b) => a.priority - b.priority || b.latestIngestedAt - a.latestIngestedAt);
}

export function ChangeClassificationSection({
  items,
  now = new Date(),
}: ChangeClassificationSectionProps) {
  const classifications = buildChangeClassifications(items, now);
  if (classifications.length === 0) return null;

  return (
    <section aria-label="Change classification" className="space-y-3">
      <div>
        <h2 className="type-title-medium text-ink-strong">Change classification</h2>
        <p className="type-body-small text-ink-soft">
          Source signals grouped by the kind of follow-up they suggest.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {classifications.map((classification) => (
          <li
            key={`${classification.entryId}-${classification.label}`}
            className="border-outline-variant bg-surface-container-lowest rounded-[1rem] border p-4"
          >
            <p className="type-label-small text-ink-muted">{classification.label}</p>
            <p className="type-body-medium text-ink-strong mt-1">{classification.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
