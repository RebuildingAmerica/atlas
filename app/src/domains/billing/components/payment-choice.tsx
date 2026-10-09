import { RadioOption } from "@rebuildingamerica/atlas-ui/ui/radio-option";
import { disclosureSummaryClass } from "@rebuildingamerica/atlas-ui/styles/controls";
import type { AtlasSelfServeProduct } from "@rebuildingamerica/atlas-access/workspace/capabilities";
import type { PricingCheckoutInterval } from "../checkout-intervals";

interface PaymentOption {
  interval: PricingCheckoutInterval;
  label: string;
  price: string;
  cadence: string;
  description?: string;
  savings?: string;
  commitment: string;
  renewal: string;
}
interface PaymentSelectionProps {
  product: AtlasSelfServeProduct;
  interval: string;
}

interface PaymentChoiceProps extends PaymentSelectionProps {
  onChange: (value: PricingCheckoutInterval) => void;
}

const OPTIONS: Record<AtlasSelfServeProduct, PaymentOption[]> = {
  atlas_pro: [
    {
      interval: "monthly",
      label: "Monthly",
      price: "$5",
      cadence: "/month",
      commitment: "$5 per month",
      renewal: "Renews monthly. Cancel in your account.",
    },
    {
      interval: "yearly",
      label: "Annual",
      price: "$48",
      cadence: "/year",
      savings: "Save 20%",
      commitment: "$48 per year",
      renewal: "Renews annually. Cancel in your account.",
    },
    {
      interval: "four_month",
      label: "Student",
      price: "$12.80",
      cadence: "/4 months",
      description: "Verify your student status before checkout.",
      commitment: "$12.80 every four months",
      renewal: "Student verification is required. Renews every 4 months. Cancel in your account.",
    },
  ],
  atlas_team: [
    {
      interval: "monthly",
      label: "Monthly",
      price: "$25",
      cadence: "/month",
      description: "1 member included. $8 per additional member each month.",
      commitment: "$25 per month + $8 per additional member per month",
      renewal: "Renews monthly. Cancel in your account.",
    },
    {
      interval: "yearly",
      label: "Annual",
      price: "$250",
      cadence: "/year",
      description: "1 member included. $80 per additional member each year.",
      commitment: "$250 per year + $80 per additional member per year",
      renewal: "Renews annually. Cancel in your account.",
    },
  ],
  atlas_research_pass: [
    {
      interval: "weekly",
      label: "7 days",
      price: "$4",
      cadence: "once",
      description: "One payment for a week of research tools.",
      commitment: "$4 for 7 days",
      renewal: "Access ends after 7 days. No automatic renewal.",
    },
    {
      interval: "once",
      label: "30 days",
      price: "$9",
      cadence: "once",
      description: "One payment for a month of research tools.",
      commitment: "$9 for 30 days",
      renewal: "Access ends after 30 days. No automatic renewal.",
    },
  ],
};

function selectedOption(product: AtlasSelfServeProduct, interval: string): PaymentOption {
  const option = OPTIONS[product].find((option) => option.interval === interval);
  if (!option) throw new Error("This payment option is unavailable.");
  return option;
}

export function PaymentChoice({ product, interval, onChange }: PaymentChoiceProps) {
  const options = OPTIONS[product];
  const studentOption = product === "atlas_pro" ? selectedOption(product, "four_month") : null;
  const renderOption = (option: PaymentOption) => (
    <RadioOption
      key={option.interval}
      name="interval"
      value={option.interval}
      label={option.label}
      description={option.description}
      badge={option.savings}
      trailing={
        <>
          {option.price}
          <span className="type-body-small text-ink-soft ml-1">{option.cadence}</span>
        </>
      }
      checked={interval === option.interval}
      onChange={() => {
        onChange(option.interval);
      }}
    />
  );
  return (
    <fieldset className="space-y-4">
      <legend className="type-title-large text-ink-strong mb-4">Billing period</legend>
      <div className="space-y-3">
        {options.filter((option) => option.interval !== "four_month").map(renderOption)}
      </div>
      {studentOption ? (
        <details className="group" open={interval === "four_month" ? true : undefined}>
          <summary className={disclosureSummaryClass}>
            Student pricing · {studentOption.price} {studentOption.cadence}
          </summary>
          <div className="pt-2">
            {options.filter((option) => option.interval === "four_month").map(renderOption)}
          </div>
        </details>
      ) : null}
    </fieldset>
  );
}

/** Renewal terms stay near the next action without repeating the selected price. */
export function PaymentTerms({ product, interval }: PaymentSelectionProps) {
  return (
    <section aria-label="Renewal terms">
      <p className="type-body-medium text-ink-soft">{selectedOption(product, interval).renewal}</p>
    </section>
  );
}

export function PaymentCommitment({ product, interval }: PaymentSelectionProps) {
  const option = selectedOption(product, interval);
  return (
    <section aria-label="Payment summary" className="space-y-2">
      <p className="type-title-large text-ink-strong">{option.commitment}</p>
      <p className="type-body-medium text-ink-soft">{option.renewal}</p>
      <p className="type-body-small text-ink-muted">Any applicable tax is shown at checkout.</p>
    </section>
  );
}
