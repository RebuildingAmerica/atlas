// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/platform/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="page-layout">{children}</div>
  ),
}));

vi.mock("@/platform/ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

describe("routes/_public/enterprise", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the enterprise marketing page with feature list and onboarding steps", async () => {
    const routeModule = await import("@/routes/_public/enterprise");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    expect(
      screen.getByRole("heading", { name: /Enterprise SSO for civic research teams/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Single Sign-On/)).toBeInTheDocument();
    expect(screen.getByText(/Workspace governance/)).toBeInTheDocument();
    expect(screen.getByText(/Create your account/)).toBeInTheDocument();
    expect(screen.getByText(/Activate Atlas Team/)).toBeInTheDocument();
    expect(screen.getByText(/Configure SSO/)).toBeInTheDocument();
    expect(screen.getByText("hello@rebuildingus.org")).toBeInTheDocument();
  });
});
