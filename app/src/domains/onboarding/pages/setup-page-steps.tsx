/**
 * The purchase step rail and the panel it frames.
 *
 * Both are presentational. They render whichever step the page is on and
 * say nothing about how the page got there.
 */

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SetupInterval } from "@rebuildingamerica/atlas-access/onboarding/setup-state";

export type PurchaseStepId = "account" | "security" | "workspace" | "payment";

interface PurchaseStep {
  description: string;
  id: PurchaseStepId;
  title: string;
}

const PURCHASE_STEPS: readonly PurchaseStep[] = [
  {
    description: "Create or open your account.",
    id: "account",
    title: "Account",
  },
  {
    description: "Add the required passkey.",
    id: "security",
    title: "Security",
  },
  {
    description: "Choose where the plan belongs.",
    id: "workspace",
    title: "Workspace",
  },
  {
    description: "Finish with Stripe.",
    id: "payment",
    title: "Payment",
  },
];

export function stepIndex(step: PurchaseStepId): number {
  return PURCHASE_STEPS.findIndex((item) => item.id === step);
}

export function PurchaseStepRail({
  activeStep,
  authenticated,
  interval,
  productLabel,
}: {
  activeStep: PurchaseStepId;
  authenticated: boolean;
  interval: SetupInterval;
  productLabel: string;
}) {
  const activeIndex = stepIndex(activeStep);
  return (
    <aside
      className={cn(
        "border-outline-variant bg-surface-container-lowest overflow-hidden rounded-3xl border transition-all duration-500 ease-out",
        authenticated ? "lg:max-w-[16rem]" : "lg:max-w-[23rem]",
      )}
    >
      <div
        className={cn(
          "space-y-6 p-5 transition-all duration-500",
          authenticated ? "lg:p-4" : "lg:p-6",
        )}
      >
        <div className="space-y-2">
          <p className="type-label-medium text-outline">Selected plan</p>
          <h1
            className={cn(
              "text-on-surface transition-all duration-500",
              authenticated ? "type-title-large" : "type-display-small",
            )}
          >
            {productLabel}
          </h1>
          <p className="type-body-medium text-outline">Billing: {interval}</p>
        </div>

        <ol className="space-y-3">
          {PURCHASE_STEPS.map((step, index) => {
            const complete = index < activeIndex;
            const active = step.id === activeStep;
            return (
              <li
                key={step.id}
                className={cn(
                  "rounded-2xl border px-3 py-3 transition-all duration-300",
                  active
                    ? "border-primary bg-primary-container text-on-primary-container"
                    : "border-outline-variant bg-surface text-on-surface",
                  complete && "bg-surface-container-low text-outline",
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "type-label-medium flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                      active
                        ? "border-on-primary-container bg-on-primary-container text-primary-container"
                        : complete
                          ? "border-outline bg-outline text-surface"
                          : "border-outline-variant text-outline",
                    )}
                    aria-hidden="true"
                  >
                    {complete ? "✓" : index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="type-label-large block">{step.title}</span>
                    <span
                      className={cn(
                        "type-body-small text-outline block transition-opacity duration-300",
                        authenticated && !active ? "lg:opacity-0" : "opacity-100",
                      )}
                    >
                      {step.description}
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}

export function PurchaseStepPanel({
  children,
  description,
  eyebrow,
  title,
}: {
  children: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <section className="border-outline-variant bg-surface-container-lowest min-h-[32rem] rounded-3xl border p-6 shadow-[0_24px_80px_rgba(26,22,18,0.08)] sm:p-8">
      <div className="mx-auto flex min-h-[28rem] w-full max-w-2xl flex-col justify-center space-y-8">
        <div className="space-y-3">
          <p className="type-label-medium text-outline">{eyebrow}</p>
          <h2 className="type-display-small text-on-surface">{title}</h2>
          <p className="type-body-large text-outline">{description}</p>
        </div>
        {children}
      </div>
    </section>
  );
}
