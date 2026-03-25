import type { Entry } from "@/types";

interface EntryDetailProps {
  entry?: Entry;
  isLoading?: boolean;
  error?: Error | null;
}

/** Entry detail component. Implementation pending. */
export function EntryDetail({ entry }: EntryDetailProps) {
  if (!entry) {
    return <p className="text-gray-600">Entry not found.</p>;
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="text-2xl font-bold text-gray-900">{entry.name}</h2>
      <p className="mt-4 text-gray-600">{entry.description}</p>
      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-gray-200 pt-6 md:grid-cols-3">
        <div>
          <p className="text-sm text-gray-500">Type</p>
          <p className="font-semibold text-gray-900">{entry.type}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Status</p>
          <p className="font-semibold text-gray-900">
            {entry.verified ? "Verified" : "Unverified"}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Active</p>
          <p className="font-semibold text-gray-900">{entry.active ? "Yes" : "No"}</p>
        </div>
      </div>
    </div>
  );
}
