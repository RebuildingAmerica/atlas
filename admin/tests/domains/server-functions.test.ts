import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getCloudCostPosture: vi.fn(),
  lookupAccount: vi.fn(),
  listPlatformSwitches: vi.fn(),
  listVerifications: vi.fn(),
  setPlatformSwitch: vi.fn(),
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

  it("loads the switches and flips one with the operator's reason", async () => {
    const { flipSwitch, loadSwitches } =
      await import("@/domains/switches/switches.functions");
    api.listPlatformSwitches.mockResolvedValue({ items: [] });
    api.setPlatformSwitch.mockResolvedValue({ engaged: true });

    expect(await loadSwitches()).toEqual({ items: [] });
    await flipSwitch({
      data: { engaged: true, name: "checkout", reason: " Stripe outage " },
    });

    expect(api.setPlatformSwitch).toHaveBeenCalledWith("checkout", {
      engaged: true,
      reason: "Stripe outage",
    });
  });

  it("looks up an account and refuses an empty query", async () => {
    const { findAccount } =
      await import("@/domains/accounts/accounts.functions");
    api.lookupAccount.mockResolvedValue({ account: null, workspaces: [] });

    await findAccount({ data: { query: " dana@example.org " } });
    expect(api.lookupAccount).toHaveBeenCalledWith({
      query: "dana@example.org",
    });

    await expect(findAccount({ data: { query: "  " } })).rejects.toThrow(
      "Type an email address",
    );
  });

  it("refuses to flip a switch without a reason", async () => {
    const { flipSwitch } =
      await import("@/domains/switches/switches.functions");

    await expect(
      flipSwitch({ data: { engaged: true, name: "checkout", reason: " " } }),
    ).rejects.toThrow("Say why");
    expect(api.setPlatformSwitch).not.toHaveBeenCalled();
  });
});
