// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWebManifest, readPublicPngSize } from "@/../tests/helpers/web-manifest-harness";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@vercel/analytics/react", () => ({
  Analytics: () => <div data-testid="vercel-analytics" />,
}));

vi.mock("@vercel/speed-insights/react", () => ({
  SpeedInsights: () => <div data-testid="vercel-speed-insights" />,
}));

vi.mock("@/platform/pages/not-found-page", () => ({
  NotFoundPage: () => <div data-testid="not-found-page" />,
}));

vi.mock("@/platform/pages/error-page", () => ({
  ErrorPage: () => <div data-testid="error-page" />,
}));

vi.mock("@/styles/app.css", () => ({}));

describe("routes/__root", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("exposes the not-found and error components used by the root route", async () => {
    const routeModule = await import("@/routes/__root");
    const { NotFoundPage } = await import("@/platform/pages/not-found-page");
    const { ErrorPage } = await import("@/platform/pages/error-page");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.notFoundComponent).toBe(NotFoundPage);
    expect(Route.options.errorComponent).toBe(ErrorPage);
  });

  it("renders the root document with the Outlet, analytics, and speed insights", async () => {
    const routeModule = await import("@/routes/__root");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");

    const markup = renderToStaticMarkup(<Component />);

    expect(markup).toContain('data-testid="router-outlet"');
    expect(markup).toContain('data-testid="vercel-analytics"');
    expect(markup).toContain('data-testid="vercel-speed-insights"');
    expect(markup).toContain('class="bg-background text-on-surface flex min-h-screen flex-col"');
  });

  it("leaves route titles and descriptions to HeadContent", async () => {
    const routeModule = await import("@/routes/__root");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");

    const markup = renderToStaticMarkup(<Component />);

    expect(markup).toContain('<meta charSet="utf-8"/>');
    expect(markup).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
    );
    expect(markup).not.toContain("<title>");
    expect(markup).not.toContain('name="description"');
  });

  it("advertises Atlas favicon assets for browsers and connector clients", async () => {
    const routeModule = await import("@/routes/__root");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");

    const markup = renderToStaticMarkup(<Component />);

    expect(markup).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>');
    expect(markup).toContain('<link rel="alternate icon" href="/favicon.ico"/>');
    expect(markup).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png"/>');
    expect(markup).toContain('<link rel="manifest" href="/site.webmanifest"/>');
  });

  it("tints the browser chrome to the page background in both color schemes", async () => {
    const routeModule = await import("@/routes/__root");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");

    const markup = renderToStaticMarkup(<Component />);

    expect(markup).toContain(
      '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f6f1e7"/>',
    );
    expect(markup).toContain(
      '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#17130f"/>',
    );
  });

  it("lists installable icons in the web manifest that exist at their declared sizes", () => {
    const manifest = loadWebManifest();

    expect(manifest).toMatchObject({
      background_color: "#f6f1e7",
      name: "Atlas",
      short_name: "Atlas",
      theme_color: "#f6f1e7",
    });
    expect(manifest.icons.map(({ purpose, sizes }) => `${purpose} ${sizes}`)).toEqual([
      "any 192x192",
      "any 512x512",
      "maskable 512x512",
    ]);
    for (const icon of manifest.icons) {
      expect(readPublicPngSize(icon.src)).toBe(icon.sizes);
    }
    expect(readPublicPngSize("/apple-touch-icon.png")).toBe("180x180");
  });
});
