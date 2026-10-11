// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { discountRequest, passingPosture } from "../fixtures/admin";
import { renderWithQueries } from "../helpers/render";

const functions = vi.hoisted(() => ({
  loadCloudCostPosture: vi.fn(),
  loadDiscountRequests: vi.fn(),
  reviewDiscountRequest: vi.fn(),
}));

vi.mock("@/domains/discounts/discounts.functions", () => ({
  loadDiscountRequests: functions.loadDiscountRequests,
  reviewDiscountRequest: functions.reviewDiscountRequest,
}));
vi.mock("@/domains/cloud-costs/cloud-costs.functions", () => ({
  loadCloudCostPosture: functions.loadCloudCostPosture,
}));

describe("DiscountReviewPage", () => {
  it("loads requests, records a decision and reloads the list", async () => {
    const { DiscountReviewPage } =
      await import("@/domains/discounts/discount-review-page");
    functions.loadDiscountRequests.mockResolvedValue({
      records: [discountRequest()],
      total: 1,
    });
    functions.reviewDiscountRequest.mockResolvedValue({ status: "verified" });
    renderWithQueries(<DiscountReviewPage />);

    await userEvent.type(
      await screen.findByRole("textbox"),
      "Checked the school email",
    );
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(functions.loadDiscountRequests).toHaveBeenCalledTimes(2);
    });
    expect(functions.reviewDiscountRequest).toHaveBeenCalledWith({
      data: {
        notes: "Checked the school email",
        status: "verified",
        verificationId: "v-1",
      },
    });
  });

  it("shows the API's sentence when a decision fails", async () => {
    const { DiscountReviewPage } =
      await import("@/domains/discounts/discount-review-page");
    functions.loadDiscountRequests.mockResolvedValue({
      records: [discountRequest()],
      total: 1,
    });
    functions.reviewDiscountRequest.mockRejectedValue(
      new Error(
        "The decision was saved, but the applicant could not be emailed.",
      ),
    );
    renderWithQueries(<DiscountReviewPage />);

    await userEvent.type(await screen.findByRole("textbox"), "Not enrolled");
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));

    expect(
      await screen.findByText(
        "The decision was saved, but the applicant could not be emailed.",
      ),
    ).toBeInTheDocument();
  });

  it("says when the requests could not load", async () => {
    const { DiscountReviewPage } =
      await import("@/domains/discounts/discount-review-page");
    functions.loadDiscountRequests.mockRejectedValue(new Error(""));
    renderWithQueries(<DiscountReviewPage />);

    expect(
      await screen.findByText("Discount requests could not load."),
    ).toBeInTheDocument();
  });
});

describe("CloudCostsPage", () => {
  it("says when the posture could not load", async () => {
    const { CloudCostsPage } =
      await import("@/domains/cloud-costs/cloud-costs-page");
    functions.loadCloudCostPosture.mockRejectedValue(
      new Error("Sign in again through Cloudflare Access."),
    );
    renderWithQueries(<CloudCostsPage />);

    expect(
      await screen.findByText("Sign in again through Cloudflare Access."),
    ).toBeInTheDocument();
  });

  it("shows the posture once loaded", async () => {
    const { CloudCostsPage } =
      await import("@/domains/cloud-costs/cloud-costs-page");
    functions.loadCloudCostPosture.mockResolvedValue(passingPosture());
    renderWithQueries(<CloudCostsPage />);

    expect(await screen.findByText("$1.00")).toBeInTheDocument();
  });
});
