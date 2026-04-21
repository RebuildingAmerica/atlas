import { useState } from "react";
import { Button } from "@/platform/ui/button";

interface CivicTechFormProps {
  onSubmit: (data: { projectUrl: string; mission: string }) => Promise<void>;
  isLoading?: boolean;
}

export function CivicTechForm({ onSubmit, isLoading = false }: CivicTechFormProps) {
  const [projectUrl, setProjectUrl] = useState("");
  const [mission, setMission] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!projectUrl.trim()) {
      setError("Project URL is required");
      return;
    }

    if (!mission.trim()) {
      setError("Mission statement is required");
      return;
    }

    try {
      new URL(projectUrl);
    } catch {
      setError("Please enter a valid project URL");
      return;
    }

    if (mission.length < 20) {
      setError("Mission statement should be at least 20 characters");
      return;
    }

    void onSubmit({ projectUrl, mission }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Submission failed");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-ink-strong mb-2 block text-sm font-medium">Project URL</label>
        <p className="text-ink-soft mb-2 text-sm">
          GitHub repository, project website, or nonprofit organization page
        </p>
        <input
          type="url"
          value={projectUrl}
          onChange={(e) => {
            setProjectUrl(e.target.value);
          }}
          placeholder="https://github.com/user/civic-tool"
          className="border-border w-full rounded-lg border px-3 py-2"
          disabled={isLoading}
        />
      </div>

      <div>
        <label className="text-ink-strong mb-2 block text-sm font-medium">Mission Statement</label>
        <p className="text-ink-soft mb-2 text-sm">
          How does this project support civic engagement or government accountability?
        </p>
        <textarea
          value={mission}
          onChange={(e) => {
            setMission(e.target.value);
          }}
          placeholder="We build tools to help citizens understand local government budgets..."
          rows={4}
          className="border-border w-full rounded-lg border px-3 py-2"
          disabled={isLoading}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button type="submit" disabled={isLoading} className="w-full">
        {isLoading ? "Submitting..." : "Request Verification"}
      </Button>

      <p className="text-ink-soft text-xs">
        Your submission will be reviewed to confirm the civic mission. We'll email you once
        verified.
      </p>
    </form>
  );
}
