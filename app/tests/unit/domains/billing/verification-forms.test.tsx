// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CivicTechForm } from "@/domains/billing/verification/civic-tech-form";
import { GrassrootsNonprofitForm } from "@/domains/billing/verification/grassroots-nonprofit-form";
import { IndependentJournalistForm } from "@/domains/billing/verification/independent-journalist-form";

afterEach(cleanup);

describe("discount verification form accessibility", () => {
  it("associates grassroots nonprofit validation errors with the affected field", () => {
    render(<GrassrootsNonprofitForm onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    const organizationField = screen.getByLabelText("Organization Name or EIN");

    expect(organizationField).toHaveAttribute("aria-invalid", "true");
    expect(organizationField).toHaveAccessibleDescription("Organization name or EIN is required");

    fireEvent.change(organizationField, { target: { value: "Community Fund" } });
    fireEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    const budgetField = screen.getByLabelText("Annual Budget");

    expect(budgetField).toHaveAttribute("aria-invalid", "true");
    expect(budgetField).toHaveAccessibleDescription(
      "Must be under $2,000,000 Annual budget is required",
    );
  });

  it("associates civic tech validation errors with URL and mission fields", () => {
    render(<CivicTechForm onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    const urlField = screen.getByLabelText("Project URL");

    expect(urlField).toHaveAttribute("aria-invalid", "true");
    expect(urlField).toHaveAccessibleDescription(
      "GitHub repository, project website, or nonprofit organization page Project URL is required",
    );

    fireEvent.change(urlField, { target: { value: "https://example.org/project" } });
    fireEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    const missionField = screen.getByLabelText("Mission Statement");

    expect(missionField).toHaveAttribute("aria-invalid", "true");
    expect(missionField).toHaveAccessibleDescription(
      "How does this project support civic engagement or government accountability? Mission statement is required",
    );
  });

  it("associates independent journalist validation errors with the portfolio field", () => {
    render(<IndependentJournalistForm onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    const portfolioField = screen.getByLabelText("Portfolio or Byline URL");

    expect(portfolioField).toHaveAttribute("aria-invalid", "true");
    expect(portfolioField).toHaveAccessibleDescription(
      "Link to published work, author page, or portfolio showing your journalism Portfolio URL is required",
    );
  });
});
