import type { EntryFilterParams } from "@/types";

interface EntryFiltersProps {
  onFiltersChange: (filters: EntryFilterParams) => void;
}

/** Entry filters component. Implementation pending. */
export function EntryFilters({ onFiltersChange }: EntryFiltersProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <p className="text-gray-600">Filter controls implementation pending.</p>
      <button
        onClick={() => {
          onFiltersChange({});
        }}
        className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
      >
        Apply Filters
      </button>
    </div>
  );
}
