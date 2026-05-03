// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/billing/pages/workspace/discount-admin-page", () => ({
  DiscountAdminPage: () => null,
}));

describe("routes/_workspace/admin/discounts", () => {
  it("registers the DiscountAdminPage component", async () => {
    const { Route } = await import("@/routes/_workspace/admin.discounts");
    const { DiscountAdminPage } =
      await import("@/domains/billing/pages/workspace/discount-admin-page");
    expect(Route.options.component).toBe(DiscountAdminPage);
  });
});
