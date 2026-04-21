import { useState } from "react";
import { Button } from "@/platform/ui/button";

interface IndependentJournalistFormProps {
  onSubmit: (data: { portfolioUrl: string }) => Promise<void>;
  isLoading?: boolean;
}

export function IndependentJournalistForm({
  onSubmit,
  isLoading = false,
}: IndependentJournalistFormProps) {
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!portfolioUrl.trim()) {
      setError("Portfolio URL is required");
      return;
    }

    try {
      new URL(portfolioUrl); // Validate URL
    } catch {
      setError("Please enter a valid URL");
      return;
    }

    void onSubmit({ portfolioUrl }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Submission failed");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-ink-strong mb-2 block text-sm font-medium">
          Portfolio or Byline URL
        </label>
        <p className="text-ink-soft mb-3 text-sm">
          Link to published work, author page, or portfolio showing your journalism
        </p>
        <input
          type="url"
          value={portfolioUrl}
          onChange={(e) => {
            setPortfolioUrl(e.target.value);
          }}
          placeholder="https://example.com/my-articles"
          className="border-border w-full rounded-lg border px-3 py-2"
          disabled={isLoading}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button type="submit" disabled={isLoading} className="w-full">
        {isLoading ? "Submitting..." : "Request Verification"}
      </Button>

      <p className="text-ink-soft text-xs">
        Your submission will be reviewed manually. We'll email you once verified.
      </p>
    </form>
  );
}
