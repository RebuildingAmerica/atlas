import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SetupInterval } from "@rebuildingamerica/atlas-access/onboarding/setup-state";

export type PurchaseStepId = "plan" | "account" | "security" | "workspace" | "payment";

const PURCHASE_STEPS = [
  { id: "plan", title: "Plan" },
  { id: "account", title: "Account" },
  { id: "workspace", title: "Workspace" },
  { id: "payment", title: "Payment" },
] as const;

const BILLING_LABELS: Record<SetupInterval, string> = {
  monthly: "Monthly",
  yearly: "Annual",
  four_month: "Every 4 months",
  weekly: "7-day pass",
  once: "30-day pass",
};

export function stepIndex(step: PurchaseStepId): number {
  const visibleStep = step === "security" ? "account" : step;
  return PURCHASE_STEPS.findIndex((item) => item.id === visibleStep);
}

export function PurchaseProgress({ activeStep }: { activeStep: PurchaseStepId }) {
  const activeIndex = stepIndex(activeStep);
  return (
    <nav aria-label="Signup progress">
      <ol className="grid grid-cols-4 gap-3">
        {PURCHASE_STEPS.map((step, index) => (
          <li key={step.id} aria-current={index === activeIndex ? "step" : undefined}>
            <div
              aria-hidden="true"
              className={cn(
                "mb-2 h-1 rounded-full",
                index <= activeIndex ? "bg-accent-deep" : "bg-border-strong",
              )}
            />
            <span
              className={cn(
                "type-label-medium block text-center",
                index === activeIndex ? "text-ink-strong font-semibold" : "text-ink-muted",
              )}
            >
              {step.title}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PurchaseStepRail({
  activeStep,
  interval,
  productLabel,
}: {
  activeStep: PurchaseStepId;
  interval: SetupInterval;
  productLabel: string;
}) {
  return (
    <div className="space-y-6">
      <PurchaseProgress activeStep={activeStep} />
      <p className="type-body-medium text-ink-muted">
        {productLabel} · {BILLING_LABELS[interval]}
      </p>
    </div>
  );
}

export function PurchaseStepPanel({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-ink-strong font-serif text-4xl leading-tight tracking-tight text-balance sm:text-5xl">
          {title}
        </h1>
        <p className="type-body-large text-ink-soft">{description}</p>
      </div>
      {children}
    </section>
  );
}
