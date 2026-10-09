import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAtlasSessionFixture } from "../../../fixtures/access/sessions";
import { assertPaidAdmission } from "@/domains/waitlist/server/admission";
import type * as WaitlistRuntime from "@/domains/waitlist/server/runtime";
import { paidAccessMode } from "@/domains/waitlist/server/runtime";
const mocks = vi.hoisted(() => ({ isAdmitted: vi.fn(), products: vi.fn() }));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/waitlist/server/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof WaitlistRuntime>()),
  getWaitlistStore: () => Promise.resolve({ isAdmitted: mocks.isAdmitted }),
}));
vi.mock("@/domains/access/server/workspace-products", () => ({
  queryActiveProducts: mocks.products,
}));

describe("paid admission", () => {
  beforeEach(() => {
    vi.stubEnv("ATLAS_MANAGED", "true");
    vi.stubEnv("ATLAS_MULTI_USER", "true");
    vi.stubEnv("ATLAS_PAID_ACCESS_MODE", "waitlist");
    mocks.products.mockResolvedValue([]);
    mocks.isAdmitted.mockResolvedValue(false);
  });
  it("refuses uninvited purchases but permits the approved product", async () => {
    const session = createAtlasSessionFixture();
    await expect(assertPaidAdmission(session, "atlas_pro")).rejects.toThrow("invitation");
    mocks.isAdmitted.mockImplementation((_email: string, product: string) =>
      Promise.resolve(product === "atlas_pro"),
    );
    await expect(assertPaidAdmission(session, "atlas_pro")).resolves.toBeUndefined();
    await expect(assertPaidAdmission(session, "atlas_team")).rejects.toThrow("invitation");
  });
  it("rejects unverified email and preserves an existing managed paid workspace", async () => {
    const session = createAtlasSessionFixture();
    await expect(
      assertPaidAdmission(
        { ...session, user: { ...session.user, emailVerified: false } },
        "atlas_pro",
      ),
    ).rejects.toThrow("Verify");
    mocks.products.mockResolvedValue(["atlas_pro"]);
    await expect(assertPaidAdmission(session, "atlas_pro")).resolves.toBeUndefined();
    await expect(assertPaidAdmission(session, "atlas_pro", "unrelated-workspace")).rejects.toThrow(
      "invitation",
    );
  });
  it("requires explicit managed configuration and permits intentional open mode", async () => {
    expect(() => paidAccessMode({ ATLAS_MANAGED: "true" })).toThrow("explicitly");
    expect(paidAccessMode({ ATLAS_MANAGED: "false" })).toBe("open");
    expect(paidAccessMode({ ATLAS_MANAGED: "true", ATLAS_PAID_ACCESS_MODE: "open" })).toBe("open");
    vi.stubEnv("ATLAS_PAID_ACCESS_MODE", "open");
    await expect(
      assertPaidAdmission(createAtlasSessionFixture(), "atlas_pro"),
    ).resolves.toBeUndefined();
  });
});
