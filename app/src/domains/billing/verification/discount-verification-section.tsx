import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { DiscountSegment } from "../discount-segments";
import { DISCOUNT_SEGMENT_LABELS } from "../discount-segments";
import { VerificationForm } from "./verification-form";

interface DiscountVerificationSectionProps {
  userId: string;
}

interface ErrorResponse {
  detail: string;
}

export function DiscountVerificationSection({ userId }: DiscountVerificationSectionProps) {
  const [selectedSegment, setSelectedSegment] = useState<DiscountSegment | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const submitVerificationMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const response = await fetch("/api/access/verify-discount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segment: selectedSegment,
          user_id: userId,
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
        <div className="border-border bg-surface-container-lowest rounded-[1.4rem] border p-5">
          <p className="type-title-small text-ink-strong">Verification submitted</p>
          <p className="type-body-medium text-ink-soft mt-2">
            We've received your verification request for discount access. We'll review it and email
            you within 24 hours to let you know if you qualify.
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
        <VerificationForm
          segment={selectedSegment}
          onSubmit={async (data) => {
            await submitVerificationMutation.mutateAsync(data);
            setHasSubmitted(true);
          }}
          isLoading={submitVerificationMutation.isPending}
        />
        {submitVerificationMutation.isError && (
          <p className="type-body-medium text-red-700">
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
        <p className="type-title-small text-ink-strong">Request discount access</p>
        <p className="type-body-medium text-ink-soft mt-2">
          Atlas offers discounted access for independent journalists, grassroots nonprofits, and
          civic tech workers. If that describes you, submit verification and we'll review your
          request.
        </p>

        <div className="mt-4 space-y-2">
          {(["independent_journalist", "grassroots_nonprofit", "civic_tech_worker"] as const).map(
            (segment) => (
              <button
                key={segment}
                onClick={() => {
                  setSelectedSegment(segment);
                }}
                className="border-border hover:border-ink-muted hover:bg-surface-container-lowest w-full rounded-lg border px-4 py-3 text-left transition-colors"
              >
                <p className="type-body-medium text-ink-strong">
                  {DISCOUNT_SEGMENT_LABELS[segment]}
                </p>
              </button>
            ),
          )}
        </div>

        <p className="type-body-small text-ink-soft mt-4">
          Not applicable? No problem — you can still use Atlas at full price. You can request
          verification anytime.
        </p>
      </div>
    </div>
  );
}
