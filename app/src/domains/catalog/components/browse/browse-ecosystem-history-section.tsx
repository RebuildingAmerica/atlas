import { formatStableDateTime, MONTH_YEAR } from "@rebuildingamerica/atlas-ui/format/date-time";
import type { Entry } from "@rebuildingamerica/atlas-api-client";

interface BrowseEcosystemHistorySectionProps {
  entries: Entry[];
  issueLabel: string | undefined;
  placeLabel: string | undefined;
  total: number;
}

const TYPE_LABELS: Record<Entry["type"], string> = {
  campaign: "Campaigns",
  event: "Events",
  initiative: "Initiatives",
  organization: "Organizations",
  person: "People",
};

interface DatedEntry {
  entry: Entry;
  firstSeen: Date;
  latestActivity: Date;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date;
}

function formatMonth(value: Date): string {
  return formatStableDateTime(value, MONTH_YEAR);
}

function compareDates(left: Date, right: Date): number {
  return left.getTime() - right.getTime();
}

function datedEntry(entry: Entry): DatedEntry | undefined {
  const firstSeen = parseDate(entry.first_seen);
  const latestActivity =
    parseDate(entry.latest_source_date) ??
    parseDate(entry.last_seen) ??
    parseDate(entry.updated_at);

  if (!firstSeen || !latestActivity) {
    return undefined;
  }

  return { entry, firstSeen, latestActivity };
}

function actorMixSignal(entries: DatedEntry[]): string {
  const counts = entries.reduce<Record<Entry["type"], number>>(
    (current, item) => ({
      ...current,
      [item.entry.type]: current[item.entry.type] + 1,
    }),
    {
      campaign: 0,
      event: 0,
      initiative: 0,
      organization: 0,
      person: 0,
    },
  );
  const typeOrder = entries.map((item) => item.entry.type);
  const strongest = Object.entries(counts).sort((left, right) => {
    const countDifference = right[1] - left[1];
    if (countDifference !== 0) {
      return countDifference;
    }

    return (
      typeOrder.indexOf(left[0] as Entry["type"]) - typeOrder.indexOf(right[0] as Entry["type"])
    );
  })[0];

  if (!strongest || strongest[1] === 0) {
    return "Dated records are too thin to identify an actor mix.";
  }

  return `${TYPE_LABELS[strongest[0] as Entry["type"]]} lead the visible actor mix.`;
}

export function BrowseEcosystemHistorySection({
  entries,
  issueLabel,
  placeLabel,
  total,
}: BrowseEcosystemHistorySectionProps) {
  const datedEntries = entries.map(datedEntry).filter((entry) => entry !== undefined);

  if (datedEntries.length === 0) {
    return null;
  }

  const firstDatedEntry = datedEntries[0];
  if (!firstDatedEntry) {
    return null;
  }

  const firstSeen = datedEntries.reduce(
    (earliest, item) => (compareDates(item.firstSeen, earliest.firstSeen) < 0 ? item : earliest),
    firstDatedEntry,
  ).firstSeen;
  const latestActivity = datedEntries.reduce(
    (latest, item) =>
      compareDates(item.latestActivity, latest.latestActivity) > 0 ? item : latest,
    firstDatedEntry,
  ).latestActivity;
  const sourceTotal = datedEntries.reduce((sum, item) => sum + item.entry.source_count, 0);
  const contextLabel = [placeLabel, issueLabel].filter(Boolean).join(" ");
  const title = contextLabel ? `${contextLabel} history` : "Landscape history";
  const recordLabel = datedEntries.length === 1 ? "dated record" : "dated records";
  const resultLabel = total === 1 ? "record" : "records";

  return (
    <section
      aria-label="Ecosystem history"
      className="border-border bg-surface-container-lowest rounded-[1.25rem] border px-3 py-3 lg:px-4"
    >
      <div className="flex flex-col gap-1.5 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="type-label-small text-ink-muted uppercase">Ecosystem history</p>
          <h2 className="type-title-large text-ink-strong mt-1">{title}</h2>
        </div>
        <p className="type-body-small text-ink-muted">
          {total} {resultLabel}
        </p>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <div className="border-border bg-surface-container rounded-[0.85rem] border px-3 py-2.5">
          <p className="type-label-small text-ink-muted uppercase">Record span</p>
          <p className="type-title-medium text-ink-strong mt-1">
            {formatMonth(firstSeen)} - {formatMonth(latestActivity)}
          </p>
          <p className="type-body-small text-ink-soft mt-1">
            {datedEntries.length} {recordLabel} with dated public activity.
          </p>
        </div>
        <div className="border-border bg-surface-container rounded-[0.85rem] border px-3 py-2.5">
          <p className="type-label-small text-ink-muted uppercase">Latest activity</p>
          <p className="type-title-medium text-ink-strong mt-1">
            Latest activity {formatMonth(latestActivity)}
          </p>
          <p className="type-body-small text-ink-soft mt-1">
            {sourceTotal} linked sources across {datedEntries.length} {recordLabel}.
          </p>
        </div>
        <div className="border-border bg-surface-container rounded-[0.85rem] border px-3 py-2.5">
          <p className="type-label-small text-ink-muted uppercase">Actor mix</p>
          <p className="type-title-medium text-ink-strong mt-1">{actorMixSignal(datedEntries)}</p>
        </div>
      </div>
    </section>
  );
}
