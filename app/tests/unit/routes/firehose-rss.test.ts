import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildFirehoseRss: vi.fn(),
  listPublicFirehoseSignals: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/firehose/public-feed", () => ({
  listPublicFirehoseSignals: mocks.listPublicFirehoseSignals,
}));

vi.mock("@/domains/firehose/rss", () => ({
  buildFirehoseRss: mocks.buildFirehoseRss,
}));

describe("routes/firehose.rss", () => {
  beforeEach(() => {
    mocks.buildFirehoseRss.mockReset();
    mocks.listPublicFirehoseSignals.mockReset();
  });

  it("returns RSS XML for the filtered public Firehose feed", async () => {
    const snapshot = { signals: [] };
    mocks.listPublicFirehoseSignals.mockReturnValue(snapshot);
    mocks.buildFirehoseRss.mockReturnValue("<rss />");
    const routeModule = await import("@/routes/firehose[.]rss");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const response = (await Route.options.server?.handlers?.GET?.({
      request: new Request("https://atlas.example/firehose.rss?place=detroit-mi"),
    })) as Response;

    expect(mocks.listPublicFirehoseSignals).toHaveBeenCalledWith({ place: "detroit-mi" });
    expect(mocks.buildFirehoseRss).toHaveBeenCalledWith(
      snapshot,
      "https://atlas.example/firehose.rss?place=detroit-mi",
    );
    expect(response.headers.get("Content-Type")).toBe("application/rss+xml; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=60");
    await expect(response.text()).resolves.toBe("<rss />");
  });
});
