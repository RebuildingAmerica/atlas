import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
  sendDiscountRequestOperatorNotification: vi.fn(),
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
}));

describe("discount verification server functions", () => {
  afterEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.sendDiscountRequestOperatorNotification.mockReset();
  });

  it("notifies the platform operator when a new request is submitted", async () => {
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
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/access/verify-discount", {
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

  it("reads the current workspace's verification status", async () => {
    const status = {
      record: {
        id: "verif_123",
        organization_id: "org_123",
        segment: "student",
        status: "verified",
        submitted_at: "2026-07-01T00:00:00.000Z",
        verified_at: "2026-07-02T00:00:00.000Z",
      },
    };
    mocks.requestAtlasApi.mockResolvedValue(status);

    const { getCurrentDiscountVerificationStatus } =
      await import("@/domains/billing/discount-verifications.functions");

    const result = await getCurrentDiscountVerificationStatus({
      data: { organizationId: "org_123" },
    });

    expect(result).toBe(status);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/access/discount-verification/current");
  });
});
