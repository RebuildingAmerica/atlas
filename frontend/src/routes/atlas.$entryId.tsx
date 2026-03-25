import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/atlas/$entryId")({
  ssr: true,
  component: EntryPage,
});

function EntryPage() {
  const { entryId } = Route.useParams();

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-3xl font-bold text-gray-900">Entry Detail</h1>
      <p className="mt-2 text-gray-600">Detailed view of entry {entryId}.</p>
      <div className="mt-8 rounded-lg border-2 border-dashed border-gray-300 p-12 text-center text-gray-500">
        Entry detail implementation pending.
      </div>
    </div>
  );
}
