import { afterEach, describe, expect, it, vi } from "vitest";
import type { VerificationListResponse } from "@/lib/generated/atlas-schemas/access/verificationListResponse";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

describe("discount verification server functions", () => {
  afterEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
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
      record: { id: "verif_123" },
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
      record: { id: "verif_123" },
      status: "verified",
    });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/api/admin/verifications/verif_123", {
      body: JSON.stringify({
        notes: "Approved from admin review.",
        status: "verified",
      }),
      method: "PATCH",
    });
  });
});
