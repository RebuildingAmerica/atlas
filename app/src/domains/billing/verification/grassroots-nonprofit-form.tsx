import { useState } from "react";
import { Button } from "@/platform/ui/button";

interface GrassrootsNonprofitFormProps {
  onSubmit: (data: { einOrName: string; budget: string }) => Promise<void>;
  isLoading?: boolean;
}

export function GrassrootsNonprofitForm({
  onSubmit,
  isLoading = false,
}: GrassrootsNonprofitFormProps) {
  const [einOrName, setEinOrName] = useState("");
  const [budget, setBudget] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!einOrName.trim()) {
      setError("Organization name or EIN is required");
      return;
    }

    if (!budget.trim()) {
      setError("Annual budget is required");
      return;
    }

    const budgetNum = parseFloat(budget.replace(/[^0-9.]/g, ""));
    if (isNaN(budgetNum) || budgetNum >= 2000000) {
      setError("Budget must be under $2,000,000");
      return;
    }

    void onSubmit({ einOrName, budget }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Submission failed");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-ink-strong mb-2 block text-sm font-medium">
          Organization Name or EIN
        </label>
        <input
          type="text"
          value={einOrName}
          onChange={(e) => {
            setEinOrName(e.target.value);
          }}
          placeholder="Your nonprofit name or 12-345678"
          className="border-border w-full rounded-lg border px-3 py-2"
          disabled={isLoading}
        />
      </div>

      <div>
        <label className="text-ink-strong mb-2 block text-sm font-medium">Annual Budget</label>
        <p className="text-ink-soft mb-2 text-sm">Must be under $2,000,000</p>
        <input
          type="text"
          value={budget}
          onChange={(e) => {
            setBudget(e.target.value);
          }}
          placeholder="$500,000"
          className="border-border w-full rounded-lg border px-3 py-2"
          disabled={isLoading}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button type="submit" disabled={isLoading} className="w-full">
        {isLoading ? "Submitting..." : "Request Verification"}
      </Button>

      <p className="text-ink-soft text-xs">
        We'll verify your 501(c)(3) status and budget via IRS records or Form 990.
      </p>
    </form>
  );
}
