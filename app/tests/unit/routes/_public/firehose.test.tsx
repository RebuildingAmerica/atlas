// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { PageHead } from "@/platform/seo";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchPublicFirehoseSignals: vi.fn(),
  firehosePageProps: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@rebuildingamerica/atlas-catalog/firehose/firehose-feed-page", () => ({
  FirehoseFeedPage: (props: { initialSnapshot: unknown }) => {
    mocks.firehosePageProps(props);
    return <div data-testid="firehose-page" />;
  },
}));

vi.mock("@rebuildingamerica/atlas-catalog/firehose/public-feed", () => ({
  publicFirehoseSearchSchema: {
    parse: vi.fn((input: unknown) => input),
  },
}));

vi.mock("@/platform/firehose/public-feed", () => ({
  fetchPublicFirehoseSignals: mocks.fetchPublicFirehoseSignals,
}));

describe("routes/_public/firehose", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    mocks.fetchPublicFirehoseSignals.mockReset();
    mocks.firehosePageProps.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads the public Firehose snapshot from the search params", async () => {
    const snapshot = { signals: [] };
    mocks.fetchPublicFirehoseSignals.mockResolvedValue(snapshot);
    const routeModule = await import("@/routes/_public/firehose");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const result = await Route.options.loader?.({
      deps: { search: { issue: "transit", place: "detroit-mi" } },
    });

    expect(mocks.fetchPublicFirehoseSignals).toHaveBeenCalledWith({
      issue: "transit",
      place: "detroit-mi",
    });
    expect(result).toEqual({ initialSnapshot: snapshot });
  });

  it("declares canonical and RSS feed links while fixtures are noindexed", async () => {
    const routeModule = await import("@/routes/_public/firehose");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const head = Route.options.head?.({}) as PageHead;

    expect(head.meta).toEqual(
      expect.arrayContaining([
        { title: "Firehose | Atlas" },
        { name: "robots", content: "noindex,nofollow" },
      ]),
    );
    expect(head.links).toContainEqual({
      href: "https://atlas.rebuildingamerica.com/firehose",
      rel: "canonical",
    });
    expect(head.links).toContainEqual({
      href: "https://atlas.rebuildingamerica.com/firehose.rss",
      rel: "alternate",
    });
  });

  it("renders the feed page with the loader snapshot", async () => {
    const routeModule = await import("@/routes/_public/firehose");
    const { asRouteStub, readRouterMocks } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const router = readRouterMocks();
    const snapshot = { signals: [] };
    router.useLoaderData.mockReturnValue({ initialSnapshot: snapshot });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected component");
    render(<Component />);

    expect(screen.getByTestId("firehose-page")).toBeInTheDocument();
    expect(mocks.firehosePageProps).toHaveBeenCalledWith({ initialSnapshot: snapshot });
  });
});
