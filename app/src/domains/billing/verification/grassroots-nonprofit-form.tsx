import { useId, useState } from "react";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import type { GrassrootsNonprofitVerificationData } from "./discount-verification-payload";

type GrassrootsNonprofitErrorField = keyof GrassrootsNonprofitVerificationData;

interface GrassrootsNonprofitFormProps {
  onSubmit: (data: GrassrootsNonprofitVerificationData) => Promise<void>;
  isLoading?: boolean;
}

function describedBy(hintId: string, errorId: string | undefined): string {
  return errorId ? `${hintId} ${errorId}` : hintId;
}

export function GrassrootsNonprofitForm({
  onSubmit,
  isLoading = false,
}: GrassrootsNonprofitFormProps) {
  const formId = useId();
  const [einOrName, setEinOrName] = useState("");
  const [budget, setBudget] = useState("");
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<GrassrootsNonprofitErrorField | null>(null);

  const einOrNameId = `${formId}-ein-or-name`;
  const budgetId = `${formId}-budget`;
  const budgetHintId = `${budgetId}-hint`;
  const errorId = errorField ? `${formId}-${errorField}-error` : `${formId}-form-error`;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setErrorField(null);

    if (!einOrName.trim()) {
      setError("Organization name or EIN is required");
      setErrorField("einOrName");
      return;
    }

    if (!budget.trim()) {
      setError("Annual budget is required");
      setErrorField("budget");
      return;
    }

    const budgetNum = parseFloat(budget.replace(/[^0-9.]/g, ""));
    if (isNaN(budgetNum) || budgetNum >= 2000000) {
      setError("Budget must be under $2,000,000");
      setErrorField("budget");
      return;
    }

    void onSubmit({ einOrName, budget }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Submission failed");
      setErrorField(null);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor={einOrNameId} className="text-ink-strong mb-2 block text-sm font-medium">
          Organization Name or EIN
        </label>
        <input
          id={einOrNameId}
          type="text"
          value={einOrName}
          onChange={(e) => {
            setEinOrName(e.target.value);
          }}
          placeholder="Your nonprofit name or 12-345678"
          className="border-border w-full rounded-lg border px-3 py-2"
          disabled={isLoading}
          aria-invalid={errorField === "einOrName" ? true : undefined}
          aria-describedby={errorField === "einOrName" ? errorId : undefined}
        />
      </div>

      <div>
        <label htmlFor={budgetId} className="text-ink-strong mb-2 block text-sm font-medium">
          Annual Budget
        </label>
        <p id={budgetHintId} className="text-ink-soft mb-2 text-sm">
          Must be under $2,000,000
        </p>
        <input
          id={budgetId}
          type="text"
          value={budget}
          onChange={(e) => {
            setBudget(e.target.value);
          }}
          placeholder="$500,000"
          className="border-border w-full rounded-lg border px-3 py-2"
          disabled={isLoading}
          aria-invalid={errorField === "budget" ? true : undefined}
          aria-describedby={describedBy(
            budgetHintId,
            errorField === "budget" ? errorId : undefined,
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
        We'll verify your 501(c)(3) status and budget via manual review.
      </p>
    </form>
  );
}
