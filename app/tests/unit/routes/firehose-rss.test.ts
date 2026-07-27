import { beforeEach, describe, expect, it, vi } from "vitest";
import { callRouteGet } from "@/../tests/helpers/routes-server-handler";

const mocks = vi.hoisted(() => ({
  buildFirehoseRss: vi.fn(),
  fetchPublicFirehoseSignals: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/platform/firehose/public-feed", () => ({
  fetchPublicFirehoseSignals: mocks.fetchPublicFirehoseSignals,
}));

vi.mock("@rebuildingamerica/atlas-catalog/firehose/rss", () => ({
  buildFirehoseRss: mocks.buildFirehoseRss,
}));

describe("routes/firehose.rss", () => {
  beforeEach(() => {
    mocks.buildFirehoseRss.mockReset();
    mocks.fetchPublicFirehoseSignals.mockReset();
  });

  it("returns RSS XML for the filtered public Firehose feed", async () => {
    const snapshot = { signals: [] };
    mocks.fetchPublicFirehoseSignals.mockResolvedValue(snapshot);
    mocks.buildFirehoseRss.mockReturnValue("<rss />");
    const routeModule = await import("@/routes/firehose[.]rss");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const response = (await Route.options.server?.handlers?.GET?.({
      request: new Request("https://atlas.example/firehose.rss?place=detroit-mi"),
    })) as Response;

    expect(mocks.fetchPublicFirehoseSignals).toHaveBeenCalledWith({ place: "detroit-mi" });
    expect(mocks.buildFirehoseRss).toHaveBeenCalledWith(
      snapshot,
      "https://atlas.example/firehose.rss?place=detroit-mi",
    );
    expect(response.headers.get("Content-Type")).toBe("application/rss+xml; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=60");
    await expect(response.text()).resolves.toBe("<rss />");
  });

  it("carries every supported filter from the query string into the feed search", async () => {
    mocks.fetchPublicFirehoseSignals.mockResolvedValue({ signals: [] });
    mocks.buildFirehoseRss.mockReturnValue("<rss />");
    const routeModule = await import("@/routes/firehose[.]rss");

    await callRouteGet(
      routeModule.Route,
      new Request(
        "https://atlas.example/firehose.rss?issue=housing&issue=transit&place=detroit-mi&place=flint-mi&signal_type=government_record&source_class=primary&limit=20",
      ),
    );

    expect(mocks.fetchPublicFirehoseSignals).toHaveBeenCalledWith({
      issue: ["housing", "transit"],
      limit: "20",
      place: ["detroit-mi", "flint-mi"],
      signal_type: ["government_record"],
      source_class: ["primary"],
    });
  });

  it("asks for the unfiltered feed when the reader passed no filters", async () => {
    mocks.fetchPublicFirehoseSignals.mockResolvedValue({ signals: [] });
    mocks.buildFirehoseRss.mockReturnValue("<rss />");
    const routeModule = await import("@/routes/firehose[.]rss");

    await callRouteGet(routeModule.Route, new Request("https://atlas.example/firehose.rss"));

    expect(mocks.fetchPublicFirehoseSignals).toHaveBeenCalledWith({});
  });
});
