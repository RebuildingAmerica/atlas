import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/discovery")({
  ssr: false,
  component: DiscoveryPage,
});

function DiscoveryPage() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-3xl font-bold text-gray-900">Discovery Console</h1>
      <p className="mt-2 text-gray-600">
        Initiate new discovery runs to find and catalog entries across regions.
      </p>
      <div className="mt-8 rounded-lg border-2 border-dashed border-gray-300 p-12 text-center text-gray-500">
        Discovery console implementation pending.
      </div>
    </div>
  );
}
