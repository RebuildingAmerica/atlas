// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

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
});
