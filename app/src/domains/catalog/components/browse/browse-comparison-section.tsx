import { BarChart3, MapPinned } from "lucide-react";

export interface BrowseComparisonItem {
  count: number;
  label: string;
  value: string;
}

interface BrowseComparisonSectionProps {
  issues: BrowseComparisonItem[];
  onSelectIssue: (slug: string) => void;
  onSelectState: (state: string) => void;
  places: BrowseComparisonItem[];
}

interface ComparisonLaneProps {
  icon: "places" | "issues";
  items: BrowseComparisonItem[];
  label: string;
  onSelect: (value: string) => void;
}

function recordLabel(count: number): string {
  return `${count} ${count === 1 ? "record" : "records"}`;
}

function ComparisonLane({ icon, items, label, onSelect }: ComparisonLaneProps) {
  const Icon = icon === "places" ? MapPinned : BarChart3;

  return (
    <div className="border-border bg-surface-container-lowest rounded-[1.35rem] border p-4">
      <div className="flex items-center gap-2">
        <Icon className="text-accent h-4 w-4" aria-hidden />
        <h2 className="type-label-large text-ink-strong">{label}</h2>
      </div>
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-label={`Compare ${item.label} ${recordLabel(item.count)}`}
            onClick={() => {
              onSelect(item.value);
            }}
            className="border-border hover:border-border-strong grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors"
          >
            <span className="type-label-large text-ink-strong truncate">{item.label}</span>
            <span className="type-body-small text-ink-muted">{recordLabel(item.count)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function BrowseComparisonSection({
  issues,
  onSelectIssue,
  onSelectState,
  places,
}: BrowseComparisonSectionProps) {
  const placeItems = places.slice(0, 3);
  const issueItems = issues.slice(0, 3);

  if (placeItems.length === 0 && issueItems.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Landscape comparison"
      className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      {placeItems.length > 0 ? (
        <ComparisonLane
          icon="places"
          items={placeItems}
          label="Compare places"
          onSelect={onSelectState}
        />
      ) : null}
      {issueItems.length > 0 ? (
        <ComparisonLane
          icon="issues"
          items={issueItems}
          label="Compare issues"
          onSelect={onSelectIssue}
        />
      ) : null}
    </section>
  );
}
