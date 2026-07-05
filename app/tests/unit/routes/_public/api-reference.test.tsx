// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PageHead } from "@/platform/seo";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiReferenceProps: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@scalar/api-reference-react", () => ({
  ApiReferenceReact: (props: { configuration: { url: string } }) => {
    mocks.apiReferenceProps(props);
    return <div data-testid="scalar-api-reference" data-url={props.configuration.url} />;
  },
}));

describe("routes/_public/api-reference", () => {
  afterEach(() => {
    cleanup();
    mocks.apiReferenceProps.mockClear();
  });

  it("renders the Scalar reference against the app OpenAPI route", async () => {
    const routeModule = await import("@/routes/_public/api-reference");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.ssr).toBe(false);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");

    render(<Component />);

    expect(screen.getByTestId("scalar-api-reference")).toHaveAttribute("data-url", "/openapi.json");
    expect(mocks.apiReferenceProps).toHaveBeenCalledWith({
      configuration: { url: "/openapi.json" },
    });
  });

  it("publishes API reference metadata", async () => {
    const routeModule = await import("@/routes/_public/api-reference");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const head = Route.options.head?.({}) as PageHead;

    expect(head.meta).toEqual(
      expect.arrayContaining([
        { title: "API Reference | Atlas" },
        {
          name: "description",
          content: "Explore the generated Atlas REST API reference.",
        },
      ]),
    );
  });
});
