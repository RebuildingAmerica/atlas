import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  DISCOUNT_SEGMENT_LABELS,
  DISCOUNT_SEGMENTS,
  SEGMENT_DESCRIPTIONS,
  type DiscountSegment,
} from "../discount-segments";
import { VerificationForm } from "./verification-form";

interface DiscountVerificationSectionProps {
  organizationId: string | null;
  userId: string;
}

interface ErrorResponse {
  detail: string;
}

interface DiscountStepperStep {
  id: string;
  label: string;
}

interface DiscountStepperProps {
  selectedSegment: DiscountSegment | null;
  hasSubmitted: boolean;
}

const DISCOUNT_STEPS: readonly DiscountStepperStep[] = [
  { id: "1", label: "Choose" },
  { id: "2", label: "Verify" },
  { id: "3", label: "Review" },
];

function DiscountStepper({ selectedSegment, hasSubmitted }: DiscountStepperProps) {
  const activeIndex = hasSubmitted ? 2 : selectedSegment ? 1 : 0;
  return (
    <ol className="mb-4 grid grid-cols-3 gap-2" aria-label="Discount request steps">
      {DISCOUNT_STEPS.map((step, index) => (
        <li key={step.id} className="flex items-center gap-2">
          <span
            className={`type-label-small flex h-7 w-7 items-center justify-center rounded-full border ${
              index <= activeIndex
                ? "border-accent bg-accent text-white"
                : "border-border text-ink-muted"
            }`}
          >
            {step.id}
          </span>
          <span className="type-label-small text-ink-muted">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function DiscountVerificationSection({
  organizationId,
  userId,
}: DiscountVerificationSectionProps) {
  const [selectedSegment, setSelectedSegment] = useState<DiscountSegment | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const submitVerificationMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      if (!organizationId) {
        throw new Error("Create a workspace before requesting discount access.");
      }

      const response = await fetch("/api/access/verify-discount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segment: selectedSegment,
          user_id: userId,
          organization_id: organizationId,
          data,
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as ErrorResponse;
        throw new Error(error.detail || "Verification submission failed");
      }

      return response.json() as Promise<unknown>;
    },
  });

  if (hasSubmitted) {
    return (
      <div className="space-y-3">
        <p className="type-label-medium text-ink-muted">Discount access</p>
        <div
          className="border-border bg-surface-container-lowest rounded-[1.4rem] border p-5"
          role="status"
        >
          <DiscountStepper selectedSegment={selectedSegment} hasSubmitted={hasSubmitted} />
          <p className="type-title-small text-ink-strong">Verification submitted</p>
          <p className="type-body-medium text-ink-soft mt-2">
            We've received your verification request for discount access. We'll review it and email
            you within 24 hours to let you know if you qualify.
          </p>
        </div>
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="space-y-3">
        <p className="type-label-medium text-ink-muted">Discount access</p>
        <div className="border-border bg-surface-container-lowest rounded-[1.4rem] border p-5">
          <p className="type-title-small text-ink-strong">Create a workspace first</p>
          <p className="type-body-medium text-ink-soft mt-2">
            Discount access is applied to a workspace before checkout.
          </p>
        </div>
      </div>
    );
  }

  if (selectedSegment) {
    return (
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <p className="type-label-medium text-ink-muted">Discount access</p>
          <button
            onClick={() => {
              setSelectedSegment(null);
            }}
            className="type-label-small text-ink-soft hover:text-ink-strong transition-colors"
          >
            Change
          </button>
        </div>
        <DiscountStepper selectedSegment={selectedSegment} hasSubmitted={hasSubmitted} />
        <VerificationForm
          segment={selectedSegment}
          onSubmit={async (data) => {
            await submitVerificationMutation.mutateAsync(data);
            setHasSubmitted(true);
          }}
          isLoading={submitVerificationMutation.isPending}
        />
        {submitVerificationMutation.isError && (
          <p className="type-body-medium text-red-700" role="alert">
            {submitVerificationMutation.error instanceof Error
              ? submitVerificationMutation.error.message
              : "Verification submission failed"}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="type-label-medium text-ink-muted">Discount access</p>
      <div className="border-border bg-surface-container-lowest rounded-[1.4rem] border p-5">
        <DiscountStepper selectedSegment={selectedSegment} hasSubmitted={hasSubmitted} />
        <p className="type-title-small text-ink-strong">Request discount access</p>
        <p className="type-body-medium text-ink-soft mt-2">
          Atlas offers discounted individual access for students, independent creators and
          journalists, grassroots nonprofits, and civic tech workers. If that describes you, submit
          verification and we'll review your request.
        </p>

        <div className="mt-4 space-y-2">
          {DISCOUNT_SEGMENTS.map((segment) => (
            <button
              key={segment}
              onClick={() => {
                setSelectedSegment(segment);
              }}
              className="border-border hover:border-ink-muted hover:bg-surface-container-lowest w-full rounded-lg border px-4 py-3 text-left transition-colors"
            >
              <p className="type-body-medium text-ink-strong">{DISCOUNT_SEGMENT_LABELS[segment]}</p>
              <p className="type-body-small text-ink-soft mt-1">{SEGMENT_DESCRIPTIONS[segment]}</p>
            </button>
          ))}
        </div>

        <p className="type-body-small text-ink-soft mt-4">
          Not applicable? No problem — you can still use Atlas at full price. You can request
          verification anytime.
        </p>
      </div>
    </div>
  );
}
