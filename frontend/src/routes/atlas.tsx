import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/atlas")({
  ssr: true,
  component: AtlasBrowsePage,
});

function AtlasBrowsePage() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-3xl font-bold text-gray-900">Browse Entries</h1>
      <p className="mt-2 text-gray-600">Search and filter entries across all regions.</p>
      <div className="mt-8 rounded-lg border-2 border-dashed border-gray-300 p-12 text-center text-gray-500">
        Atlas browse implementation pending.
      </div>
    </div>
  );
}
