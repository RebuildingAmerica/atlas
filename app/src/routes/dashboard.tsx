import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
      <p className="mt-2 text-gray-600">
        Overview of The Atlas — discovery runs, entry counts, coverage gaps.
      </p>
      <div className="mt-8 rounded-lg border-2 border-dashed border-gray-300 p-12 text-center text-gray-500">
        Dashboard implementation pending.
      </div>
    </div>
  );
}
