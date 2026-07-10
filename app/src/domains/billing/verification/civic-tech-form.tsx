import { useId, useState } from "react";
import { Button } from "@/platform/ui/button";
import type { CivicTechVerificationData } from "./discount-verification-payload";

type CivicTechErrorField = keyof CivicTechVerificationData;

interface CivicTechFormProps {
  onSubmit: (data: CivicTechVerificationData) => Promise<void>;
  isLoading?: boolean;
}

function describedBy(...ids: (string | undefined)[]): string | undefined {
  const description = ids.filter((id) => Boolean(id)).join(" ");
  return description || undefined;
}

export function CivicTechForm({ onSubmit, isLoading = false }: CivicTechFormProps) {
  const formId = useId();
  const [projectUrl, setProjectUrl] = useState("");
  const [mission, setMission] = useState("");
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<CivicTechErrorField | null>(null);

  const projectUrlId = `${formId}-project-url`;
  const projectUrlHintId = `${projectUrlId}-hint`;
  const missionId = `${formId}-mission`;
  const missionHintId = `${missionId}-hint`;
  const errorId = errorField ? `${formId}-${errorField}-error` : `${formId}-form-error`;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setErrorField(null);

    if (!projectUrl.trim()) {
      setError("Project URL is required");
      setErrorField("projectUrl");
      return;
    }

    if (!mission.trim()) {
      setError("Mission statement is required");
      setErrorField("mission");
      return;
    }

    try {
      new URL(projectUrl);
    } catch {
      setError("Please enter a valid project URL");
      setErrorField("projectUrl");
      return;
    }

    if (mission.length < 20) {
      setError("Mission statement should be at least 20 characters");
      setErrorField("mission");
      return;
    }

    void onSubmit({ projectUrl, mission }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Submission failed");
      setErrorField(null);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor={projectUrlId} className="text-ink-strong mb-2 block text-sm font-medium">
          Project URL
        </label>
        <p id={projectUrlHintId} className="text-ink-soft mb-2 text-sm">
          GitHub repository, project website, or nonprofit organization page
        </p>
        <input
          id={projectUrlId}
          type="url"
          value={projectUrl}
          onChange={(e) => {
            setProjectUrl(e.target.value);
          }}
          placeholder="https://github.com/user/civic-tool"
          className="border-border w-full rounded-lg border px-3 py-2"
          disabled={isLoading}
          aria-invalid={errorField === "projectUrl" ? true : undefined}
          aria-describedby={describedBy(
            projectUrlHintId,
            errorField === "projectUrl" ? errorId : undefined,
          )}
        />
      </div>

      <div>
        <label htmlFor={missionId} className="text-ink-strong mb-2 block text-sm font-medium">
          Mission Statement
        </label>
        <p id={missionHintId} className="text-ink-soft mb-2 text-sm">
          How does this project support civic engagement or government accountability?
        </p>
        <textarea
          id={missionId}
          value={mission}
          onChange={(e) => {
            setMission(e.target.value);
          }}
          placeholder="We build tools to help citizens understand local government budgets..."
          rows={4}
          className="border-border w-full rounded-lg border px-3 py-2"
          disabled={isLoading}
          aria-invalid={errorField === "mission" ? true : undefined}
          aria-describedby={describedBy(
            missionHintId,
            errorField === "mission" ? errorId : undefined,
          )}
        />
      </div>

      {error && (
        <p id={errorId} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

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
