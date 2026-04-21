import { useState } from "react";
import type { DiscountSegment } from "../discount-segments";
import { IndependentJournalistForm } from "./independent-journalist-form";
import { GrassrootsNonprofitForm } from "./grassroots-nonprofit-form";
import { CivicTechForm } from "./civic-tech-form";

interface VerificationFormProps {
  segment: DiscountSegment;
  onSubmit: (data: Record<string, string>) => Promise<void>;
  isLoading?: boolean;
}

export function VerificationForm({ segment, onSubmit, isLoading = false }: VerificationFormProps) {
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <h3 className="mb-2 font-semibold text-green-900">Submission Received</h3>
        <p className="text-sm text-green-800">
          We've received your verification request. You'll receive an email once it's been reviewed
          (usually within 24 hours).
        </p>
      </div>
    );
  }

  async function handleSubmit(data: Record<string, string>) {
    await onSubmit(data);
    setSubmitted(true);
  }

  if (segment === "independent_journalist") {
    return <IndependentJournalistForm onSubmit={handleSubmit} isLoading={isLoading} />;
  }

  if (segment === "grassroots_nonprofit") {
    return <GrassrootsNonprofitForm onSubmit={handleSubmit} isLoading={isLoading} />;
  }

  if (segment === "civic_tech_worker") {
    return <CivicTechForm onSubmit={handleSubmit} isLoading={isLoading} />;
  }

  return <div>Unknown segment</div>;
}
