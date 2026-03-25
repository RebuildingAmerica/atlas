import type { Entry } from "@/types";

interface EntryCardProps {
  entry: Entry;
}

/** Entry card component. Implementation pending. */
export function EntryCard({ entry }: EntryCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="font-semibold text-gray-900">{entry.name}</p>
      <p className="mt-1 text-sm text-gray-600">{entry.description}</p>
    </div>
  );
}
