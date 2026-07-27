// @vitest-environment jsdom
/* eslint-disable atlas-tests/no-test-file-locals */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscountAdminPage } from "@/domains/billing/pages/workspace/discount-admin-page";
import type { VerificationListResponse } from "@rebuildingamerica/atlas-api-client/generated/atlas-schemas/access/verificationListResponse";

const mocks = vi.hoisted(() => ({
  useHydrated: vi.fn(() => true),
  listDiscountVerifications: vi.fn(),
  reviewDiscountVerification: vi.fn(),
}));

vi.mock("@/domains/billing/discount-verifications.functions", () => ({
  listDiscountVerifications: mocks.listDiscountVerifications,
  reviewDiscountVerification: mocks.reviewDiscountVerification,
}));

vi.mock("@/platform/runtime/use-hydrated", () => ({
  useHydrated: mocks.useHydrated,
}));

const verificationListResponse: VerificationListResponse = {
  records: [
    {
      id: "verif_123",
      method: "portfolio",
      notes: "Pending review",
      organization_id: "org_123",
      segment: "independent_journalist",
      status: "pending",
      submitted_at: "2026-07-01T12:00:00.000Z",
      user_id: "user_123",
      verification_data: { portfolioUrl: "https://example.org/byline" },
      verified_at: null,
    },
  ],
  total: 1,
};

function renderDiscountAdminPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DiscountAdminPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.useHydrated.mockReset();
  mocks.useHydrated.mockReturnValue(true);
  mocks.listDiscountVerifications.mockReset();
  mocks.reviewDiscountVerification.mockReset();
  vi.unstubAllGlobals();
});

describe("DiscountAdminPage", () => {
  it("loads verification records through the authenticated server function", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    mocks.listDiscountVerifications.mockResolvedValue(verificationListResponse);

    renderDiscountAdminPage();

    const detailLink = await screen.findByRole("link", { name: "View details" });
    expect(detailLink).toHaveAttribute("href", "/admin/verifications/verif_123");
    expect(mocks.listDiscountVerifications).toHaveBeenCalledWith({ data: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("approves pending verification records by verification id", async () => {
    mocks.listDiscountVerifications
      .mockResolvedValueOnce(verificationListResponse)
      .mockResolvedValueOnce({ ...verificationListResponse, records: [] });
    mocks.reviewDiscountVerification.mockResolvedValue({
      message: "Verification review updated.",
      record: {
        ...verificationListResponse.records[0],
        status: "verified",
        verified_at: "2026-07-02T12:00:00.000Z",
      },
      status: "verified",
    });

    renderDiscountAdminPage();

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(mocks.reviewDiscountVerification).toHaveBeenCalledWith({
        data: {
          notes: "Approved from admin review.",
          status: "verified",
          verificationId: "verif_123",
        },
      });
    });
  });
  it("rejects pending verification records by verification id", async () => {
    mocks.listDiscountVerifications.mockResolvedValue(verificationListResponse);
    mocks.reviewDiscountVerification.mockResolvedValue({
      message: "Verification review updated.",
      record: { ...verificationListResponse.records[0], status: "rejected" },
      status: "rejected",
    });

    renderDiscountAdminPage();

    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(mocks.reviewDiscountVerification).toHaveBeenCalledWith({
        data: {
          notes: "Rejected from admin review.",
          status: "rejected",
          verificationId: "verif_123",
        },
      });
    });
  });

  it("says so when there are no verification requests to review", async () => {
    mocks.listDiscountVerifications.mockResolvedValue({ records: [], total: 0 });

    renderDiscountAdminPage();

    expect(await screen.findByText("No verification requests yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("surfaces the reason the verification list could not load", async () => {
    mocks.listDiscountVerifications.mockRejectedValue(
      new Error("Atlas could not reach the review API."),
    );

    renderDiscountAdminPage();

    expect(await screen.findByText("Atlas could not reach the review API.")).toBeInTheDocument();
    expect(screen.queryByText("No verification requests yet.")).not.toBeInTheDocument();
  });

  it("falls back to a readable message when the list failure is not an Error", async () => {
    mocks.listDiscountVerifications.mockRejectedValue("network down");

    renderDiscountAdminPage();

    expect(await screen.findByText("Discount verifications could not load.")).toBeInTheDocument();
  });

  it("shows reviewers the notes and outcome on an already-decided request", async () => {
    mocks.listDiscountVerifications.mockResolvedValue({
      records: [
        {
          ...verificationListResponse.records[0],
          notes: "Byline confirmed.",
          status: "verified",
          verified_at: "2026-07-02T12:00:00.000Z",
        },
      ],
      total: 1,
    });

    renderDiscountAdminPage();

    expect(await screen.findByText('"Byline confirmed."')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("shows a rejected request without review buttons", async () => {
    mocks.listDiscountVerifications.mockResolvedValue({
      records: [{ ...verificationListResponse.records[0], notes: null, status: "rejected" }],
      total: 1,
    });

    renderDiscountAdminPage();

    await screen.findByRole("link", { name: "View details" });
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });
});
