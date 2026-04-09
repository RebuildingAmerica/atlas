import type { DiscoveryRun } from "@/types";

interface DiscoveryStatusProps {
  run: DiscoveryRun;
}

/** Discovery status component. Implementation pending. */
export function DiscoveryStatus({ run }: DiscoveryStatusProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-gray-900">Run {run.id.slice(0, 8)}</p>
          <p className="text-sm text-gray-500">{new Date(run.started_at).toLocaleString()}</p>
        </div>
        <p className="rounded-full bg-gray-200 px-3 py-1 text-sm font-medium text-gray-700">
          {run.status}
        </p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-gray-500">Location</p>
          <p className="font-semibold text-gray-900">{run.location_query}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Entries Extracted</p>
          <p className="font-semibold text-gray-900">{run.entries_extracted}</p>
        </div>
      </div>
    </div>
  );
}
