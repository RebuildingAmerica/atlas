// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/admin/admin-dashboard-page", () => ({
  AdminDashboardPage: () => null,
}));

describe("routes/_workspace/admin/index", () => {
  it("registers the AdminDashboardPage component", async () => {
    const { Route } = await import("@/routes/_workspace/admin/index");
    const { AdminDashboardPage } = await import("@/domains/admin/admin-dashboard-page");
    expect(Route.options.component).toBe(AdminDashboardPage);
  });
});
