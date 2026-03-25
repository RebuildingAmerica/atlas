import type { Entry } from "@/types";

interface EntryListProps {
  entries: Entry[];
  isLoading?: boolean;
  error?: Error | null;
}

/** Entry list component. Implementation pending. */
export function EntryList({ entries }: EntryListProps) {
  return (
    <div className="space-y-4">
      {entries.length === 0 ? (
        <p className="text-gray-600">No entries to display.</p>
      ) : (
        entries.map((entry) => (
          <div key={entry.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="font-semibold text-gray-900">{entry.name}</p>
            <p className="mt-1 text-sm text-gray-600">{entry.description}</p>
          </div>
        ))
      )}
    </div>
  );
}
