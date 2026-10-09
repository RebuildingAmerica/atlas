// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  accountLookup,
  discountRequest,
  passingPosture,
  platformSwitches,
} from "../fixtures/admin";
import { renderWithQueries } from "../helpers/render";
import { reasonBox } from "../helpers/switches";

const functions = vi.hoisted(() => ({
  findAccount: vi.fn(),
  flipSwitch: vi.fn(),
  loadCloudCostPosture: vi.fn(),
  loadDiscountRequests: vi.fn(),
  loadSwitches: vi.fn(),
  reviewDiscountRequest: vi.fn(),
}));

vi.mock("@/domains/accounts/accounts.functions", () => ({
  findAccount: functions.findAccount,
}));
vi.mock("@/domains/switches/switches.functions", () => ({
  flipSwitch: functions.flipSwitch,
  loadSwitches: functions.loadSwitches,
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
        "The applicant could not be emailed, so the request is still waiting. Decide it again.",
      ),
    );
    renderWithQueries(<DiscountReviewPage />);

    await userEvent.type(await screen.findByRole("textbox"), "Not enrolled");
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));

    expect(
      await screen.findByText(
        "The applicant could not be emailed, so the request is still waiting. Decide it again.",
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

describe("AccountsPage", () => {
  it("looks up what was typed and shows the result or why it failed", async () => {
    const { AccountsPage } = await import("@/domains/accounts/accounts-page");
    functions.findAccount
      .mockResolvedValueOnce(accountLookup())
      .mockRejectedValueOnce(new Error("The Atlas app could not be asked."));
    renderWithQueries(<AccountsPage />);

    await userEvent.type(
      screen.getByLabelText("Email or workspace slug"),
      "dana@example.org",
    );
    await userEvent.click(screen.getByRole("button", { name: "Look up" }));
    expect(
      await screen.findByRole("heading", { name: "Dana · dana@example.org" }),
    ).toBeInTheDocument();
    expect(functions.findAccount).toHaveBeenCalledWith({
      data: { query: "dana@example.org" },
    });

    await userEvent.click(screen.getByRole("button", { name: "Look up" }));
    expect(
      await screen.findByText("The Atlas app could not be asked."),
    ).toBeInTheDocument();
  });
});

describe("SwitchesPage", () => {
  it("engages a switch only after the operator confirms, then reloads", async () => {
    const { SwitchesPage } = await import("@/domains/switches/switches-page");
    functions.loadSwitches.mockResolvedValue({ items: platformSwitches() });
    functions.flipSwitch.mockResolvedValue({ engaged: true });
    renderWithQueries(<SwitchesPage />);

    await screen.findAllByRole("textbox");
    await userEvent.type(reasonBox(0), "Runaway bill");
    await userEvent.click(
      screen.getByRole("button", { name: "Stop discovery spend" }),
    );
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(functions.flipSwitch).not.toHaveBeenCalled();
    expect(reasonBox(0)).toHaveValue("Runaway bill");

    await userEvent.click(
      screen.getByRole("button", { name: "Stop discovery spend" }),
    );
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Engage",
      }),
    );

    await waitFor(() => {
      expect(functions.loadSwitches).toHaveBeenCalledTimes(2);
    });
    expect(functions.flipSwitch).toHaveBeenCalledWith({
      data: { engaged: true, name: "discovery_spend", reason: "Runaway bill" },
    });
  });

  it("releases after confirmation and says when the change failed", async () => {
    const { SwitchesPage } = await import("@/domains/switches/switches-page");
    functions.loadSwitches.mockResolvedValue({ items: platformSwitches() });
    functions.flipSwitch.mockRejectedValue(new Error("API down"));
    renderWithQueries(<SwitchesPage />);

    await screen.findAllByRole("textbox");
    await userEvent.type(reasonBox(1), "Stripe fixed it");
    await userEvent.click(screen.getByRole("button", { name: "Reopen sales" }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Release",
      }),
    );

    expect(await screen.findByText("API down")).toBeInTheDocument();
  });

  it("holds a switch while its change is saving", async () => {
    const { SwitchesPage } = await import("@/domains/switches/switches-page");
    functions.loadSwitches.mockResolvedValue({ items: platformSwitches() });
    functions.flipSwitch.mockReturnValue(new Promise(() => undefined));
    renderWithQueries(<SwitchesPage />);

    await screen.findAllByRole("textbox");
    await userEvent.type(reasonBox(1), "Stripe fixed it");
    await userEvent.click(screen.getByRole("button", { name: "Reopen sales" }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Release",
      }),
    );

    await waitFor(() => {
      expect(reasonBox(1)).toBeDisabled();
    });
  });

  it("says when the switches cannot load", async () => {
    const { SwitchesPage } = await import("@/domains/switches/switches-page");
    functions.loadSwitches.mockRejectedValue("down");
    renderWithQueries(<SwitchesPage />);

    expect(
      await screen.findByText("Switches could not load."),
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
