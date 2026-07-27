// @vitest-environment jsdom
/* eslint-disable atlas-tests/no-test-file-locals */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscountVerificationSection } from "@/domains/billing/verification/discount-verification-section";

const mocks = vi.hoisted(() => ({
  getCurrentDiscountVerificationStatus: vi.fn(),
  submitDiscountVerification: vi.fn(),
}));

vi.mock("@/domains/billing/discount-verifications.functions", () => ({
  getCurrentDiscountVerificationStatus: mocks.getCurrentDiscountVerificationStatus,
  submitDiscountVerification: mocks.submitDiscountVerification,
}));

function renderDiscountVerificationSection(organizationId: string | null = "org_123") {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  if (!mocks.getCurrentDiscountVerificationStatus.getMockImplementation()) {
    mocks.getCurrentDiscountVerificationStatus.mockResolvedValue({ record: null });
  }

  return render(
    <QueryClientProvider client={queryClient}>
      <DiscountVerificationSection organizationId={organizationId} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mocks.getCurrentDiscountVerificationStatus.mockReset();
  mocks.submitDiscountVerification.mockReset();
});

describe("DiscountVerificationSection", () => {
  it("shows the durable pending status for the active workspace after refresh", async () => {
    mocks.getCurrentDiscountVerificationStatus.mockResolvedValue({
      record: {
        id: "verif_123",
        segment: "student",
        status: "pending",
        submitted_at: "2026-07-11T12:00:00.000Z",
      },
    });

    renderDiscountVerificationSection();

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Discount request under review");
    });
    expect(screen.queryByRole("button", { name: /Student/i })).not.toBeInTheDocument();
  });

  it("announces submitted verification requests as a status", async () => {
    mocks.submitDiscountVerification.mockResolvedValue({ status: "pending" });
    renderDiscountVerificationSection();

    fireEvent.click(screen.getByRole("button", { name: /Independent Creator or Journalist/i }));
    fireEvent.change(screen.getByLabelText("Portfolio or Byline URL"), {
      target: { value: "https://example.org/byline" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Verification submitted");
    });
  });

  it("submits student discount requests through the stepper", async () => {
    mocks.submitDiscountVerification.mockResolvedValue({ status: "pending" });
    renderDiscountVerificationSection();

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Student/i }));
    fireEvent.change(screen.getByLabelText("School email"), {
      target: { value: "maya@university.edu" },
    });
    fireEvent.change(screen.getByLabelText("School or program"), {
      target: { value: "Howard University" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    await waitFor(() => {
      expect(mocks.submitDiscountVerification).toHaveBeenCalled();
    });
    expect(mocks.submitDiscountVerification).toHaveBeenCalledWith({
      data: {
        organizationId: "org_123",
        segment: "student",
        submission: {
          schoolEmail: "maya@university.edu",
          schoolName: "Howard University",
        },
      },
    });
  });

  it("submits independent creator and journalist requests through the stepper", async () => {
    mocks.submitDiscountVerification.mockResolvedValue({ status: "pending" });
    renderDiscountVerificationSection();

    fireEvent.click(screen.getByRole("button", { name: /Independent Creator or Journalist/i }));
    fireEvent.change(screen.getByLabelText("Portfolio or Byline URL"), {
      target: { value: "https://example.org/reporter/byline" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    await waitFor(() => {
      expect(mocks.submitDiscountVerification).toHaveBeenCalled();
    });
    expect(mocks.submitDiscountVerification).toHaveBeenCalledWith({
      data: {
        organizationId: "org_123",
        segment: "independent_journalist",
        submission: {
          portfolioUrl: "https://example.org/reporter/byline",
        },
      },
    });
  });

  it("announces failed verification requests as an alert", async () => {
    mocks.submitDiscountVerification.mockRejectedValue(new Error("Verification failed"));
    renderDiscountVerificationSection();

    fireEvent.click(screen.getByRole("button", { name: /Independent Creator or Journalist/i }));
    fireEvent.change(screen.getByLabelText("Portfolio or Byline URL"), {
      target: { value: "https://example.org/byline" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Verification failed");
    });
  });
  it("lets the applicant go back and pick a different segment", async () => {
    renderDiscountVerificationSection();

    fireEvent.click(screen.getByRole("button", { name: /Student/i }));
    expect(screen.getByLabelText("School email")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));

    await waitFor(() => {
      expect(screen.queryByLabelText("School email")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Student/i })).toBeInTheDocument();
  });

  it("asks an operator with no workspace to create one before requesting a discount", async () => {
    renderDiscountVerificationSection(null);

    expect(await screen.findByText("Create a workspace first")).toBeInTheDocument();
    expect(
      screen.getByText("Discount access is applied to a workspace before checkout."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Student/i })).not.toBeInTheDocument();
    expect(mocks.getCurrentDiscountVerificationStatus).not.toHaveBeenCalled();
  });

  it("falls back to a readable message when the failure is not an Error", async () => {
    mocks.submitDiscountVerification.mockRejectedValue("network down");
    renderDiscountVerificationSection();

    fireEvent.click(screen.getByRole("button", { name: /Independent Creator or Journalist/i }));
    fireEvent.change(screen.getByLabelText("Portfolio or Byline URL"), {
      target: { value: "https://example.org/byline" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    await waitFor(() => {
      expect(screen.getByText("Verification submission failed")).toBeInTheDocument();
    });
  });
  it("shows a rejected applicant their outcome and still lets them reapply", async () => {
    mocks.getCurrentDiscountVerificationStatus.mockResolvedValue({
      record: {
        id: "verif_123",
        organization_id: "org_123",
        segment: "student",
        status: "rejected",
        submitted_at: "2026-07-11T12:00:00.000Z",
      },
    });

    renderDiscountVerificationSection();

    expect(await screen.findByText("Discount request not approved")).toBeInTheDocument();
    expect(
      screen.getByText("You can submit a new request if your eligibility has changed."),
    ).toBeInTheDocument();
    expect(screen.getByText("Request type: Student")).toBeInTheDocument();
    expect(screen.getByText("Request discount access")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Student/i })).toBeInTheDocument();
  });
});
