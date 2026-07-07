export interface BrowseIntentChip {
  id: string;
  label: string;
  onRemove: () => void;
}

interface BrowseIntentChipsProps {
  chips: BrowseIntentChip[];
}

/**
 * Selected browse filters shown as removable chips.
 */
export function BrowseIntentChips({ chips }: BrowseIntentChipsProps) {
  if (chips.length === 0) {
    return null;
  }

  return (
    <div className="bg-surface-container-lowest flex flex-wrap items-center gap-2 rounded-[1rem] px-3 py-2">
      <span className="type-label-small text-ink-muted">Filters</span>
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          aria-label={`Remove ${chip.label}`}
          onClick={chip.onRemove}
          className="type-label-large bg-surface-container-high text-ink-soft hover:text-ink-strong rounded-full px-2.5 py-1 transition-colors"
          title={`Remove ${chip.label}`}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
