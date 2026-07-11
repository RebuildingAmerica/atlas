import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentDiscountVerificationResponse } from "@/domains/billing/server/discount-verifications";

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

  it("returns the approved discount segment for the current checkout workspace", async () => {
    const response: CurrentDiscountVerificationResponse = {
      record: {
        id: "verif_123",
        organization_id: "org_123",
        segment: "student",
        status: "verified",
        submitted_at: "2026-07-01T12:00:00.000Z",
        verified_at: "2026-07-02T12:00:00.000Z",
      },
    };
    mocks.requestAtlasApi.mockResolvedValue(response);

    const { getVerifiedDiscountSegmentForWorkspace } =
      await import("@/domains/billing/server/discount-verifications");

    await expect(getVerifiedDiscountSegmentForWorkspace("org_123")).resolves.toBe("student");
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/access/discount-verification/current");
  });

  it("returns null when the workspace has no approved discount", async () => {
    const response: CurrentDiscountVerificationResponse = { record: null };
    mocks.requestAtlasApi.mockResolvedValue(response);

    const { getVerifiedDiscountSegmentForWorkspace } =
      await import("@/domains/billing/server/discount-verifications");

    await expect(getVerifiedDiscountSegmentForWorkspace("org_456")).resolves.toBeNull();
  });

  it("returns null when the current verification belongs to another workspace", async () => {
    const response: CurrentDiscountVerificationResponse = {
      record: {
        id: "verif_123",
        organization_id: "org_other",
        segment: "independent_journalist",
        status: "verified",
        submitted_at: "2026-07-01T12:00:00.000Z",
        verified_at: "2026-07-02T12:00:00.000Z",
      },
    };
    mocks.requestAtlasApi.mockResolvedValue(response);

    const { getVerifiedDiscountSegmentForWorkspace } =
      await import("@/domains/billing/server/discount-verifications");

    await expect(getVerifiedDiscountSegmentForWorkspace("org_456")).resolves.toBeNull();
  });
});
