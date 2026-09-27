import { EntryCard } from "@/domains/catalog/components/entries/entry-card";
import { useEntry } from "@rebuildingamerica/atlas-catalog/hooks/use-entries";
import type { Entry } from "@rebuildingamerica/atlas-api-client";

interface SelectedMapResultProps {
  selectedId: string;
  entries: Entry[];
  issueAreaLabels: Record<string, string>;
  onClear: () => void;
}

/** Keep a chosen map actor visible even when it falls outside the current results page. */
export function SelectedMapResult({
  selectedId,
  entries,
  issueAreaLabels,
  onClear,
}: SelectedMapResultProps) {
  const listedEntry = entries.find((entry) => entry.id === selectedId);
  const selectedQuery = useEntry(selectedId, { enabled: !listedEntry });

  return (
    <section aria-label="Selected on map" className="max-w-4xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="type-headline-small text-ink-strong">Selected on map</h2>
        <button
          type="button"
          onClick={onClear}
          className="type-label-medium text-ink-soft hover:text-ink-strong underline underline-offset-4"
        >
          Clear selection
        </button>
      </div>
      {listedEntry ? (
        <a
          href="#selected-map-result"
          className="type-body-medium text-ink-strong hover:text-accent underline underline-offset-4"
        >
          {listedEntry.name}
        </a>
      ) : selectedQuery.data ? (
        <EntryCard entry={selectedQuery.data} issueAreaLabels={issueAreaLabels} isMapSelection />
      ) : selectedQuery.isError ? (
        <p role="alert" className="type-body-medium text-ink-soft">
          Selected profile unavailable.
        </p>
      ) : (
        <p role="status" className="type-body-medium text-ink-soft">
          Loading
        </p>
      )}
    </section>
  );
}
