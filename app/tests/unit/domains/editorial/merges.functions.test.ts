import { afterEach, describe, expect, it, vi } from "vitest";
import { apiProfileMerge, profileMerge } from "../../../fixtures/editorial/merges";

const mocks = vi.hoisted(() => ({ requestAtlasApi: vi.fn() }));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

describe("merge server functions", () => {
  afterEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
  });

  it("lists past merges", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ items: [apiProfileMerge()] });
    const { listMerges } = await import("@/domains/editorial/merges.functions");

    await expect(listMerges()).resolves.toEqual([profileMerge()]);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/merges");
  });

  it("checks a merge by the slugs in the pasted addresses", async () => {
    mocks.requestAtlasApi.mockResolvedValue({
      blockers: ["Reno Tenants is taken down."],
      duplicate: {
        active: false,
        id: "d",
        name: "Reno Tenants",
        slug: "reno-tenants",
        type: "organization",
      },
      keep: {
        active: true,
        id: "k",
        name: "Reno Tenants Union",
        slug: "rtu",
        type: "organization",
      },
      moves: apiProfileMerge().moved,
    });
    const { previewMerge } = await import("@/domains/editorial/merges.functions");

    const preview = await previewMerge({
      data: {
        duplicate: "https://atlas.rebuildingus.org/profiles/organizations/reno-tenants",
        keep: "rtu",
      },
    });

    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/merges/preview?duplicate=reno-tenants&keep=rtu",
    );
    expect(preview.blockers).toEqual(["Reno Tenants is taken down."]);
    expect(preview.moves).toEqual(profileMerge().moved);
  });

  it("merges with the editor's reason and refuses one without", async () => {
    mocks.requestAtlasApi.mockResolvedValue(apiProfileMerge());
    const { mergeProfiles } = await import("@/domains/editorial/merges.functions");

    await expect(
      mergeProfiles({ data: { duplicate: "reno-tenants", keep: "rtu", reason: " " } }),
    ).rejects.toThrow();
    const merged = await mergeProfiles({
      data: { duplicate: "reno-tenants", keep: "rtu", reason: " Same EIN on both filings. " },
    });

    expect(mocks.requestAtlasApi).toHaveBeenCalledTimes(1);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/merges", {
      body: JSON.stringify({
        duplicate: "reno-tenants",
        keep: "rtu",
        reason: "Same EIN on both filings.",
      }),
      method: "POST",
    });
    expect(merged).toEqual(profileMerge());
  });
});
