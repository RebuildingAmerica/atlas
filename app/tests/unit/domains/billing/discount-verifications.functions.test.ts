import { afterEach, describe, expect, it, vi } from "vitest";
import type { VerificationListResponse } from "@/lib/generated/atlas-schemas/access/verificationListResponse";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
  sendDiscountRequestOperatorNotification: vi.fn(),
  sendDiscountReviewResultEmail: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

vi.mock("@/domains/billing/server/discount-verification-emails", () => ({
  sendDiscountRequestOperatorNotification: mocks.sendDiscountRequestOperatorNotification,
  sendDiscountReviewResultEmail: mocks.sendDiscountReviewResultEmail,
}));

describe("discount verification server functions", () => {
  afterEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.sendDiscountRequestOperatorNotification.mockReset();
    mocks.sendDiscountReviewResultEmail.mockReset();
  });

  it("lists verification records through the authenticated API bridge", async () => {
    const response: VerificationListResponse = {
      records: [],
      total: 0,
    };
    mocks.requestAtlasApi.mockResolvedValue(response);

    const { listDiscountVerifications } =
      await import("@/domains/billing/discount-verifications.functions");

    const result = await listDiscountVerifications({
      data: {
        organizationId: "org_123",
        status: "pending",
      },
    });

    expect(result).toBe(response);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/api/admin/verifications?organization_id=org_123&status=pending",
    );
  });

  it("updates verification review state through the authenticated API bridge", async () => {
    mocks.requestAtlasApi.mockResolvedValue({
      message: "Verification review updated.",
      record: {
        id: "verif_123",
        segment: "student",
        status: "verified",
        user_id: "user_123",
      },
      status: "verified",
    });

    const { reviewDiscountVerification } =
      await import("@/domains/billing/discount-verifications.functions");

    const result = await reviewDiscountVerification({
      data: {
        notes: "Approved from admin review.",
        status: "verified",
        verificationId: "verif_123",
      },
    });

    expect(result).toEqual({
      message: "Verification review updated.",
      record: {
        id: "verif_123",
        segment: "student",
        status: "verified",
        user_id: "user_123",
      },
      status: "verified",
    });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/api/admin/verifications/verif_123", {
      body: JSON.stringify({
        notes: "Approved from admin review.",
        status: "verified",
      }),
      method: "PATCH",
    });
    expect(mocks.sendDiscountReviewResultEmail).toHaveBeenCalledWith({
      segment: "student",
      status: "verified",
      userId: "user_123",
    });
  });

  it("notifies operator review recipients when a new request is submitted", async () => {
    mocks.requestAtlasApi.mockResolvedValue({
      id: "verif_456",
      organization_id: "org_123",
      status: "pending",
      verification_method: "portfolio",
    });

    const { submitDiscountVerification } =
      await import("@/domains/billing/discount-verifications.functions");

    const result = await submitDiscountVerification({
      data: {
        organizationId: "org_123",
        segment: "independent_journalist",
        submission: {
          portfolioUrl: "https://example.org/byline",
        },
      },
    });

    expect(result).toEqual({
      id: "verif_456",
      organization_id: "org_123",
      status: "pending",
      verification_method: "portfolio",
    });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/api/access/verify-discount", {
      body: JSON.stringify({
        data: {
          portfolioUrl: "https://example.org/byline",
        },
        organization_id: "org_123",
        segment: "independent_journalist",
      }),
      method: "POST",
    });
    expect(mocks.sendDiscountRequestOperatorNotification).toHaveBeenCalledWith({
      organizationId: "org_123",
      segment: "independent_journalist",
      verificationId: "verif_456",
    });
  });

  it("does not send review-result email when the review API rejects the actor", async () => {
    mocks.requestAtlasApi.mockRejectedValue(new Error("Atlas API request failed (403)"));

    const { reviewDiscountVerification } =
      await import("@/domains/billing/discount-verifications.functions");

    await expect(
      reviewDiscountVerification({
        data: {
          notes: "No qualifying evidence.",
          status: "rejected",
          verificationId: "verif_denied",
        },
      }),
    ).rejects.toThrow("Atlas API request failed (403)");

    expect(mocks.sendDiscountReviewResultEmail).not.toHaveBeenCalled();
  });
});
