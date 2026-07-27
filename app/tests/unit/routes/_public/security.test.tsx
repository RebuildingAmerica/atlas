// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("routes/_public/security", () => {
  afterEach(() => {
    cleanup();
  });

  it("serves the security text at this route", async () => {
    const { Route } = await import("@/routes/_public/security");
    const { SecurityPage } = await import("@/platform/pages/security-page");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Component = asRouteStub(Route).options.component;

    expect(Component).toBe(SecurityPage);
    if (!Component) throw new Error("Expected a route component");
    render(<Component />);

    expect(screen.getByRole("heading", { level: 1, name: "Security" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Responsible disclosure" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Operational monitoring and status visibility")).toBeInTheDocument();
    expect(screen.getByText("Last updated:").parentElement).toHaveTextContent(
      "Last updated: April 23, 2026",
    );
  });

  it("publishes SEO metadata for the security page", async () => {
    const { Route } = await import("@/routes/_public/security");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const route = asRouteStub(Route);

    const head = route.options.head?.({}) as {
      meta: Record<string, string>[];
      links: Record<string, string>[];
    };

    expect(head.meta).toEqual(
      expect.arrayContaining([
        { title: "Security | Atlas" },
        {
          name: "description",
          content:
            "Atlas security practices for account access, infrastructure, and responsible disclosure.",
        },
        { property: "og:url", content: "https://atlas.rebuildingamerica.com/security" },
        { name: "twitter:card", content: "summary_large_image" },
      ]),
    );
    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://atlas.rebuildingamerica.com/security",
    });
  });
});
