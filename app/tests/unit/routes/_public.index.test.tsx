// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/platform/pages/home-page", () => ({
  HomePage: () => null,
}));

describe("routes/_public/index", () => {
  it("registers the HomePage component for the public landing route", async () => {
    const { Route } = await import("@/routes/_public/index");
    const { HomePage } = await import("@/platform/pages/home-page");
    expect(Route.options.component).toBe(HomePage);
  });
});
