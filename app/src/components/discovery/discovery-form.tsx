import type { StartDiscoveryRequest } from "@/types";

interface DiscoveryFormProps {
  onSubmit: (data: StartDiscoveryRequest) => void;
  isLoading?: boolean;
}

/** Research form component. Implementation pending. */
export function DiscoveryForm({ onSubmit, isLoading }: DiscoveryFormProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      location_query: "",
      research_goal: "landscape_scan",
      state: "",
      issue_areas: [],
    });
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold text-gray-900">Start research</h3>
      <p className="text-gray-600">Research form implementation pending.</p>
      <button
        type="submit"
        disabled={isLoading}
        className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isLoading ? "Starting..." : "Start research"}
      </button>
    </form>
  );
}
