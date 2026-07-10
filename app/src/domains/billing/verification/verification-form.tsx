import { useState } from "react";
import type { DiscountSegment } from "../discount-segments";
import { IndependentJournalistForm } from "./independent-journalist-form";
import { GrassrootsNonprofitForm } from "./grassroots-nonprofit-form";
import { CivicTechForm } from "./civic-tech-form";
import { StudentForm } from "./student-form";
import type { DiscountVerificationSubmission } from "./discount-verification-payload";

interface VerificationFormProps {
  segment: DiscountSegment;
  onSubmit: (submission: DiscountVerificationSubmission) => Promise<void>;
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

  async function handleSubmit(submission: DiscountVerificationSubmission) {
    await onSubmit(submission);
    setSubmitted(true);
  }

  if (segment === "student") {
    return (
      <StudentForm
        onSubmit={(data) => handleSubmit({ data, segment: "student" })}
        isLoading={isLoading}
      />
    );
  }

  if (segment === "independent_journalist") {
    return (
      <IndependentJournalistForm
        onSubmit={(data) => handleSubmit({ data, segment: "independent_journalist" })}
        isLoading={isLoading}
      />
    );
  }

  if (segment === "grassroots_nonprofit") {
    return (
      <GrassrootsNonprofitForm
        onSubmit={(data) => handleSubmit({ data, segment: "grassroots_nonprofit" })}
        isLoading={isLoading}
      />
    );
  }

  if (segment === "civic_tech_worker") {
    return (
      <CivicTechForm
        onSubmit={(data) => handleSubmit({ data, segment: "civic_tech_worker" })}
        isLoading={isLoading}
      />
    );
  }

  return <div>Unknown segment</div>;
}
