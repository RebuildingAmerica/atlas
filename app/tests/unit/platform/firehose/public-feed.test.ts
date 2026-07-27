import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchCatalogPublicFirehoseSignals: vi.fn(),
  getServerApiBaseUrl: vi.fn(),
}));

vi.mock("@rebuildingamerica/atlas-catalog/firehose/public-feed", () => ({
  fetchPublicFirehoseSignals: mocks.fetchCatalogPublicFirehoseSignals,
}));

vi.mock("@/platform/config/app-config", () => ({
  getServerApiBaseUrl: mocks.getServerApiBaseUrl,
}));

describe("fetchPublicFirehoseSignals", () => {
  it("asks the catalog feed for the whole firehose against this deployment's API", async () => {
    mocks.getServerApiBaseUrl.mockReturnValue("https://api.atlas.test");
    mocks.fetchCatalogPublicFirehoseSignals.mockResolvedValue({ signals: [] });
    const { fetchPublicFirehoseSignals } = await import("@/platform/firehose/public-feed");

    await expect(fetchPublicFirehoseSignals()).resolves.toEqual({ signals: [] });
    expect(mocks.fetchCatalogPublicFirehoseSignals).toHaveBeenCalledWith(
      {},
      undefined,
      "https://api.atlas.test",
    );
  });

  it("passes a reader's filters and an injected fetcher straight through", async () => {
    mocks.getServerApiBaseUrl.mockReturnValue("https://api.atlas.test");
    mocks.fetchCatalogPublicFirehoseSignals.mockResolvedValue({ signals: [] });
    const fetcher = vi.fn();
    const { fetchPublicFirehoseSignals } = await import("@/platform/firehose/public-feed");

    await fetchPublicFirehoseSignals({ issue: ["housing"] }, fetcher);

    expect(mocks.fetchCatalogPublicFirehoseSignals).toHaveBeenCalledWith(
      { issue: ["housing"] },
      fetcher,
      "https://api.atlas.test",
    );
  });
});
