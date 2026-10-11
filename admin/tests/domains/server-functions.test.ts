import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getCloudCostPosture: vi.fn(),
  listVerifications: vi.fn(),
  updateVerification: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});
vi.mock("@/generated/platform-api", () => api);

describe("platform server functions", () => {
  it("loads discount requests from the platform API", async () => {
    const { loadDiscountRequests } =
      await import("@/domains/discounts/discounts.functions");
    api.listVerifications.mockResolvedValue({ records: [], total: 0 });

    expect(await loadDiscountRequests()).toEqual({ records: [], total: 0 });
  });

  it("records a decision with the operator's reason", async () => {
    const { reviewDiscountRequest } =
      await import("@/domains/discounts/discounts.functions");
    api.updateVerification.mockResolvedValue({ status: "verified" });

    await reviewDiscountRequest({
      data: {
        notes: " Enrollment letter checked ",
        status: "verified",
        verificationId: "v-1",
      },
    });

    expect(api.updateVerification).toHaveBeenCalledWith("v-1", {
      notes: "Enrollment letter checked",
      status: "verified",
    });
  });

  it("refuses a decision without a reason", async () => {
    const { reviewDiscountRequest } =
      await import("@/domains/discounts/discounts.functions");

    await expect(
      reviewDiscountRequest({
        data: { notes: "  ", status: "rejected", verificationId: "v-1" },
      }),
    ).rejects.toThrow("Say why");
    expect(api.updateVerification).not.toHaveBeenCalled();
  });

  it("loads the cloud-cost posture from the platform API", async () => {
    const { loadCloudCostPosture } =
      await import("@/domains/cloud-costs/cloud-costs.functions");
    api.getCloudCostPosture.mockResolvedValue({ posture: "pass" });

    expect(await loadCloudCostPosture()).toEqual({ posture: "pass" });
  });
});
