// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TeamSeatCostSection } from "@/domains/billing/components/team-seat-cost-section";

describe("TeamSeatCostSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing until the summary is available", () => {
    const { container } = render(<TeamSeatCostSection summary={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows seat usage and the total recurring cost with the seat breakdown", () => {
    render(
      <TeamSeatCostSection
        summary={{
          interval: "monthly",
          seatsUsed: 3,
          maxSeats: 50,
          additionalSeats: 2,
          baseCents: 2500,
          perSeatCents: 800,
          additionalSeatsCents: 1600,
          totalCents: 4100,
        }}
      />,
    );

    expect(screen.getByText("3 of 50 seats used")).toBeInTheDocument();
    expect(screen.getByText(/\$41 per month/)).toBeInTheDocument();
    expect(screen.getByText(/2 × \$8 per month/)).toBeInTheDocument();
  });

  it("notes when a single-member team has no additional seats", () => {
    render(
      <TeamSeatCostSection
        summary={{
          interval: "yearly",
          seatsUsed: 1,
          maxSeats: 50,
          additionalSeats: 0,
          baseCents: 25000,
          perSeatCents: 8000,
          additionalSeatsCents: 0,
          totalCents: 25000,
        }}
      />,
    );

    expect(screen.getByText(/no additional seats yet/)).toBeInTheDocument();
    expect(screen.getByText(/\$250 per year/)).toBeInTheDocument();
  });
});
