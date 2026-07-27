import { useId, useState } from "react";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import type { IndependentJournalistVerificationData } from "./discount-verification-payload";

type IndependentJournalistErrorField = keyof IndependentJournalistVerificationData;

interface IndependentJournalistFormProps {
  onSubmit: (data: IndependentJournalistVerificationData) => Promise<void>;
  isLoading?: boolean;
}

function describedBy(hintId: string, errorId: string | undefined): string {
  return errorId ? `${hintId} ${errorId}` : hintId;
}

export function IndependentJournalistForm({
  onSubmit,
  isLoading = false,
}: IndependentJournalistFormProps) {
  const formId = useId();
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<IndependentJournalistErrorField | null>(null);

  const portfolioUrlId = `${formId}-portfolio-url`;
  const portfolioUrlHintId = `${portfolioUrlId}-hint`;
  const errorId = errorField ? `${formId}-${errorField}-error` : `${formId}-form-error`;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setErrorField(null);

    if (!portfolioUrl.trim()) {
      setError("Portfolio URL is required");
      setErrorField("portfolioUrl");
      return;
    }

    try {
      new URL(portfolioUrl); // Validate URL
    } catch {
      setError("Please enter a valid URL");
      setErrorField("portfolioUrl");
      return;
    }

    void onSubmit({ portfolioUrl }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Submission failed");
      setErrorField(null);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor={portfolioUrlId} className="text-ink-strong mb-2 block text-sm font-medium">
          Portfolio or Byline URL
        </label>
        <p id={portfolioUrlHintId} className="text-ink-soft mb-3 text-sm">
          Link to published work, author page, or portfolio showing your journalism
        </p>
        <input
          id={portfolioUrlId}
          type="url"
          value={portfolioUrl}
          onChange={(e) => {
            setPortfolioUrl(e.target.value);
          }}
          placeholder="https://example.com/my-articles"
          className="border-border w-full rounded-lg border px-3 py-2"
          disabled={isLoading}
          aria-invalid={errorField === "portfolioUrl" ? true : undefined}
          aria-describedby={describedBy(
            portfolioUrlHintId,
            errorField === "portfolioUrl" ? errorId : undefined,
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
        Your submission will be reviewed manually. We'll email you once verified.
      </p>
    </form>
  );
}
