// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { PageHead } from "@/platform/seo";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/../tests/helpers/render-with-providers";

const mocks = vi.hoisted(() => ({
  fetchPublicFirehoseSignals: vi.fn(),
  firehosePageProps: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@rebuildingamerica/atlas-catalog/firehose/firehose-feed-page", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  FirehoseFeedPage: (props: { initialSnapshot: unknown }) => {
    mocks.firehosePageProps(props);
    return <div data-testid="firehose-page" />;
  },
}));

vi.mock("@rebuildingamerica/atlas-catalog/firehose/public-feed", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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

  it("loads no snapshot during an outage so the page renders its placeholder", async () => {
    mocks.fetchPublicFirehoseSignals.mockRejectedValue(
      new Error("Public Firehose request failed (429)"),
    );
    const routeModule = await import("@/routes/_public/firehose");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    await expect(Route.options.loader?.({ deps: { search: {} } })).resolves.toEqual({
      initialSnapshot: undefined,
    });
  });

  it("keys the loader on the search so a filter change refetches the snapshot", async () => {
    const routeModule = await import("@/routes/_public/firehose");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const loaderDeps = Route.options.loaderDeps;
    if (!loaderDeps) throw new Error("Expected Route.options.loaderDeps");
    expect(loaderDeps({ search: { issue: "transit", limit: 25 } })).toEqual({
      search: { issue: "transit", limit: 25 },
    });
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
      href: "https://atlas.rebuildingus.org/firehose",
      rel: "canonical",
    });
    expect(head.links).toContainEqual({
      href: "https://atlas.rebuildingus.org/firehose.rss",
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
    router.useSearch.mockReturnValue({});

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected component");
    render(<Component />);

    expect(screen.getByTestId("firehose-page")).toBeInTheDocument();
    expect(mocks.firehosePageProps).toHaveBeenCalledWith({ initialSnapshot: snapshot });
    expect(mocks.fetchPublicFirehoseSignals).not.toHaveBeenCalled();
  });

  it("shows the header and a feed placeholder, then the feed once the browser fetch lands", async () => {
    const routeModule = await import("@/routes/_public/firehose");
    const { asRouteStub, readRouterMocks } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const router = readRouterMocks();
    const snapshot = { signals: [] };
    router.useLoaderData.mockReturnValue({ initialSnapshot: undefined });
    router.useSearch.mockReturnValue({ place: "detroit-mi" });
    mocks.fetchPublicFirehoseSignals.mockResolvedValue(snapshot);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected component");
    renderWithProviders(<Component />);

    expect(screen.getByRole("heading", { level: 1, name: "Firehose" })).toBeInTheDocument();
    expect(screen.getByText("Loading updates")).toBeInTheDocument();
    expect(screen.getByRole("feed", { name: "Firehose events" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("link", { name: "RSS feed" })).toHaveAttribute(
      "href",
      "/firehose.rss?place=detroit-mi",
    );
    expect(screen.getByRole("button", { name: "Standard" })).toBeDisabled();

    expect(await screen.findByTestId("firehose-page")).toBeInTheDocument();
    expect(mocks.fetchPublicFirehoseSignals).toHaveBeenCalledWith({ place: "detroit-mi" });
    expect(mocks.firehosePageProps).toHaveBeenCalledWith({ initialSnapshot: snapshot });
  });

  it("points the placeholder's RSS link at the whole feed when nothing is filtered", async () => {
    const routeModule = await import("@/routes/_public/firehose");
    const { asRouteStub, readRouterMocks } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const router = readRouterMocks();
    router.useLoaderData.mockReturnValue({ initialSnapshot: undefined });
    router.useSearch.mockReturnValue({});
    mocks.fetchPublicFirehoseSignals.mockReturnValue(new Promise(() => undefined));

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected component");
    renderWithProviders(<Component />);

    expect(screen.getByRole("link", { name: "RSS feed" })).toHaveAttribute("href", "/firehose.rss");
  });
});
