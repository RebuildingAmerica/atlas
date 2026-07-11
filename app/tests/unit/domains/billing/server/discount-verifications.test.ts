import { afterEach, describe, expect, it, vi } from "vitest";
import type { VerificationListResponse } from "@/lib/generated/atlas-schemas/access/verificationListResponse";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));

vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

describe("discount verification lookup", () => {
  afterEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
  });

  it("returns the approved discount segment for a workspace", async () => {
    const response: VerificationListResponse = {
      records: [
        {
          id: "verif_123",
          method: "school_email",
          organization_id: "org_123",
          segment: "student",
          status: "verified",
          submitted_at: "2026-07-01T12:00:00.000Z",
          user_id: "user_123",
          verification_data: { schoolEmail: "student@example.edu" },
          verified_at: "2026-07-02T12:00:00.000Z",
        },
      ],
      total: 1,
    };
    mocks.requestAtlasApi.mockResolvedValue(response);

    const { getVerifiedDiscountSegmentForWorkspace } =
      await import("@/domains/billing/server/discount-verifications");

    await expect(getVerifiedDiscountSegmentForWorkspace("org_123")).resolves.toBe("student");
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/admin/verifications?organization_id=org_123&status=verified",
    );
  });

  it("returns null when the workspace has no approved discount", async () => {
    const response: VerificationListResponse = {
      records: [],
      total: 0,
    };
    mocks.requestAtlasApi.mockResolvedValue(response);

    const { getVerifiedDiscountSegmentForWorkspace } =
      await import("@/domains/billing/server/discount-verifications");

    await expect(getVerifiedDiscountSegmentForWorkspace("org_456")).resolves.toBeNull();
  });
});
