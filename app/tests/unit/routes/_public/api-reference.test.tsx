// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ApiReferenceReact } from "@scalar/api-reference-react";
import type { PageHead } from "@/platform/seo";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiReferenceProps: vi.fn<(props: Parameters<typeof ApiReferenceReact>[0]) => void>(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@scalar/api-reference-react", () => ({
  ApiReferenceReact: (props: Parameters<typeof ApiReferenceReact>[0]) => {
    mocks.apiReferenceProps(props);
    return <div data-testid="scalar-api-reference" />;
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

    expect(screen.getByTestId("scalar-api-reference")).toBeInTheDocument();
    const scalarProps = mocks.apiReferenceProps.mock.calls[0]?.[0];

    expect(scalarProps?.configuration).toEqual(
      expect.objectContaining({
        defaultHttpClient: { clientKey: "curl", targetKey: "shell" },
        hideModels: false,
        layout: "modern",
        persistAuth: true,
        showDeveloperTools: "always",
        showOperationId: true,
        url: "/openapi.json",
      }),
    );
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
