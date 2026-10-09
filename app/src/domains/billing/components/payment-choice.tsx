import { RadioOption } from "@rebuildingamerica/atlas-ui/ui/radio-option";
import { controlFocusClass } from "@rebuildingamerica/atlas-ui/styles/controls";
import type { AtlasSelfServeProduct } from "@rebuildingamerica/atlas-access/workspace/capabilities";
import type { PricingCheckoutInterval } from "../checkout-intervals";

interface PaymentOption {
  interval: PricingCheckoutInterval;
  label: string;
  price: string;
  cadence: string;
  description: string;
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
      description: "Billed monthly.",
      commitment: "$5 per month",
      renewal: "Renews monthly until canceled. Cancel from your account.",
    },
    {
      interval: "yearly",
      label: "Annual",
      price: "$48",
      cadence: "/year",
      description: "$4 per month, billed annually. Save 20% compared with monthly.",
      commitment: "$48 per year",
      renewal: "Renews annually until canceled. Cancel from your account.",
    },
    {
      interval: "four_month",
      label: "Student",
      price: "$12.80",
      cadence: "/4 months",
      description: "Student verification is required before payment.",
      commitment: "$12.80 every four months",
      renewal: "Student verification is required. Renews every four months until canceled.",
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
      renewal: "Renews monthly until canceled. Cancel from your account.",
    },
    {
      interval: "yearly",
      label: "Annual",
      price: "$250",
      cadence: "/year",
      description: "1 member included. $80 per additional member each year.",
      commitment: "$250 per year + $80 per additional member per year",
      renewal: "Renews annually until canceled. Cancel from your account.",
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
  const renderOption = (option: PaymentOption) => (
    <RadioOption
      key={option.interval}
      name="interval"
      value={option.interval}
      label={option.label}
      description={option.description}
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
      <legend className="type-title-large text-ink-strong mb-4">Choose how to pay</legend>
      <div className="space-y-3">
        {options.filter((option) => option.interval !== "four_month").map(renderOption)}
      </div>
      {product === "atlas_pro" ? (
        <details open={interval === "four_month" ? true : undefined}>
          <summary
            className={`type-label-large text-ink-soft min-h-11 cursor-pointer py-3 ${controlFocusClass}`}
          >
            Student pricing
          </summary>
          <div className="pt-2">
            {options.filter((option) => option.interval === "four_month").map(renderOption)}
          </div>
        </details>
      ) : null}
    </fieldset>
  );
}

export function PaymentCommitment({ product, interval }: PaymentSelectionProps) {
  const option = selectedOption(product, interval);
  return (
    <section aria-label="Payment summary" className="space-y-2">
      <p className="type-title-medium text-ink-strong">{option.commitment}</p>
      <p className="type-body-small text-ink-soft">{option.renewal}</p>
      <p className="type-body-small text-ink-muted">
        Any applicable tax is shown in the final total at checkout.
      </p>
    </section>
  );
}
