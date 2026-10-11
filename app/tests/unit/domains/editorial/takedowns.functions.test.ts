import { afterEach, describe, expect, it, vi } from "vitest";
import { API_TAKEDOWN, DANA_TAKEDOWN } from "../../../fixtures/editorial/takedowns";

const mocks = vi.hoisted(() => ({ requestAtlasApi: vi.fn() }));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});
vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

afterEach(() => {
  vi.resetModules();
  mocks.requestAtlasApi.mockReset();
});

describe("takedown server functions", () => {
  it("lists standing takedowns in the shape the editorial page reads", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ items: [API_TAKEDOWN] });
    const { listTakedowns } = await import("@/domains/editorial/takedowns.functions");

    await expect(listTakedowns()).resolves.toEqual([DANA_TAKEDOWN]);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/takedowns");
  });

  it.each([
    ["a full profile address", "https://atlas.rebuildingus.org/profiles/people/dana-example/"],
    ["a profile path", "/profiles/people/dana-example"],
    ["a bare slug", " dana-example "],
  ])("takes down the profile named by %s", async (_label, address) => {
    mocks.requestAtlasApi.mockResolvedValue(API_TAKEDOWN);
    const { createTakedown } = await import("@/domains/editorial/takedowns.functions");

    await createTakedown({ data: { address, reason: " Asked to be removed by email. " } });

    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/takedowns", {
      body: JSON.stringify({ reason: "Asked to be removed by email.", slug: "dana-example" }),
      method: "POST",
    });
  });

  it("refuses an address that names no profile", async () => {
    const { profileSlugFrom } = await import("@/domains/editorial/takedowns.functions");

    expect(() => profileSlugFrom("https://atlas.rebuildingus.org/")).toThrow(
      "Paste the profile's address or slug.",
    );
    expect(profileSlugFrom("caf%C3%A9-group")).toBe("café-group");
  });

  it("restores one takedown", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ ...API_TAKEDOWN, id: "take/1" });
    const { restoreTakedown } = await import("@/domains/editorial/takedowns.functions");

    const restored = await restoreTakedown({ data: { takedownId: "take/1" } });

    expect(restored.id).toBe("take/1");
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/takedowns/take%2F1/restore", {
      method: "POST",
    });
  });
});
