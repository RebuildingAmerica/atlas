// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/billing/pages/public/request-discount-page", () => ({
  RequestDiscountPage: () => null,
}));

describe("routes/_public/request-discount", () => {
  it("registers the RequestDiscountPage component", async () => {
    const { Route } = await import("@/routes/_public/request-discount");
    const { RequestDiscountPage } =
      await import("@/domains/billing/pages/public/request-discount-page");
    expect(Route.options.component).toBe(RequestDiscountPage);
  });
});
