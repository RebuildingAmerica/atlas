import { describe, expect, it, vi } from "vitest";
import { pageMeta, pageTitle, renderRoute } from "./helpers/render";

vi.mock("@/domains/discounts/discounts.functions", () => ({
  loadDiscountRequests: vi.fn(() => new Promise(() => undefined)),
  reviewDiscountRequest: vi.fn(),
}));
vi.mock("@/domains/cloud-costs/cloud-costs.functions", () => ({
  loadCloudCostPosture: vi.fn(() => new Promise(() => undefined)),
}));

describe("admin routes", () => {
  it("renders the overview inside the admin frame, marked private", async () => {
    const { html, router } = await renderRoute("/");

    expect(html).toContain("platform admin");
    expect(html).toContain('href="/discounts"');
    expect(html).toContain('href="/cloud-costs"');
    expect(html).toContain("Editorial review stays in the Atlas app");
    expect(pageTitle(router)).toBe("Atlas platform admin");
    expect(pageMeta(router)).toContainEqual({
      name: "robots",
      content: "noindex, nofollow",
    });
  });

  it("renders the discount requests page", async () => {
    const { html, router } = await renderRoute("/discounts");

    expect(html).toContain("Discount requests");
    expect(pageTitle(router)).toBe("Discount requests | Atlas platform admin");
  });

  it("renders the cloud costs page", async () => {
    const { html, router } = await renderRoute("/cloud-costs");

    expect(html).toContain("Cloud costs");
    expect(pageTitle(router)).toBe("Cloud costs | Atlas platform admin");
  });
});
