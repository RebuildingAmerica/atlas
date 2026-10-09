// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentChoice, PaymentCommitment } from "@/domains/billing/components/payment-choice";

afterEach(cleanup);

describe("payment choices", () => {
  it("opens a saved student selection and describes its full charge and verification requirement", () => {
    render(<PaymentChoice product="atlas_pro" interval="four_month" onChange={vi.fn()} />);
    const student = screen.getByRole("radio", { name: "Student" });
    expect(student).toBeVisible();
    expect(student).toBeChecked();
    expect(student).toHaveAccessibleDescription(/\$12.80.*4 months.*student status/);
  });

  it("exposes each Team price and the additional member cost before a selection", async () => {
    const onChange = vi.fn();
    render(<PaymentChoice product="atlas_team" interval="monthly" onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "Monthly" })).toHaveAccessibleDescription(
      /\$25.*month.*1 member included.*\$8/,
    );
    const annual = screen.getByRole("radio", { name: "Annual" });
    expect(annual).toHaveAccessibleDescription(/\$250.*year.*1 member included.*\$80/);
    await userEvent.click(annual);
    expect(onChange).toHaveBeenCalledWith("yearly");
    expect(screen.queryByText("Student pricing")).not.toBeInTheDocument();
  });
});

describe("payment commitment", () => {
  it.each([
    ["atlas_pro", "monthly", "$5 per month", "Renews monthly until you cancel"],
    ["atlas_pro", "yearly", "$48 per year", "Renews annually until you cancel"],
    ["atlas_pro", "four_month", "$12.80 every four months", "Student verification is required"],
    [
      "atlas_team",
      "monthly",
      "$25 per month + $8 per additional member per month",
      "Renews monthly until you cancel",
    ],
    [
      "atlas_team",
      "yearly",
      "$250 per year + $80 per additional member per year",
      "Renews annually until you cancel",
    ],
    ["atlas_research_pass", "weekly", "$4 for 7 days", "No automatic renewal"],
    ["atlas_research_pass", "once", "$9 for 30 days", "No automatic renewal"],
  ] as const)("discloses %s %s charges and renewal", (product, interval, charge, renewal) => {
    render(<PaymentCommitment product={product} interval={interval} />);
    const summary = screen.getByRole("region", { name: "Payment summary" });
    expect(summary).toHaveTextContent(charge);
    expect(summary).toHaveTextContent(renewal);
    expect(summary).toHaveTextContent("Any applicable tax is shown at checkout.");
  });

  it("rejects an unavailable interval instead of quoting a different price", () => {
    expect(() => render(<PaymentCommitment product="atlas_team" interval="weekly" />)).toThrow(
      "This payment option is unavailable.",
    );
  });
});
