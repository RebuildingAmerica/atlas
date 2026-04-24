import { expect, test } from "@playwright/test";

test.describe("public visitor journey", () => {
  test("should navigate through all public pages", async ({ page }) => {
    // 1. Home Page
    await page.goto("/");
    await expect(page).toHaveTitle(/Atlas/);
    await expect(page.getByRole("heading", { name: "Rebuilding America" })).toBeVisible();

    // 2. Browse Page
    await page.goto("/browse");
    await expect(page.getByRole("heading", { name: "Browse Atlas" })).toBeVisible();

    // Check if at least one entry is visible (assuming seed data exists or it shows a message)
    // For now, just check the heading and the search input
    await expect(page.getByPlaceholder(/Search/i)).toBeVisible();

    // 3. Pricing Page
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: "Pricing" })).toBeVisible();
    await expect(page.getByText(/Free/i)).toBeVisible();
    await expect(page.getByText(/Pro/i)).toBeVisible();

    // 4. Request Discount Page
    await page.goto("/request-discount");
    await expect(page.getByRole("heading", { name: "Request a discount" })).toBeVisible();
    await expect(page.getByLabel(/Email/i)).toBeVisible();

    // 5. Docs Page
    await page.goto("/docs");
    // Docs might redirect or have a specific heading
    await expect(page.getByRole("heading", { name: "Documentation" })).toBeVisible();
  });

  test("should be able to navigate from home to pricing", async ({ page }) => {
    await page.goto("/");
    const pricingLink = page.getByRole("link", { name: "Pricing" });
    await pricingLink.click();
    await expect(page).toHaveURL(/\/pricing/);
    await expect(page.getByRole("heading", { name: "Pricing" })).toBeVisible();
  });

  test("should render the not-found page with a visible primary action", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");

    await expect(page.getByText("404 · Page not found")).toBeVisible();
    await expect(page.getByRole("heading", { name: /We lost the map/i })).toBeVisible();
    await expect(page.getByText("Hide Error")).toHaveCount(0);

    const primaryCta = page.getByRole("button", { name: /Back to home/i });
    await expect(primaryCta).toBeVisible();
    await expect(primaryCta).toHaveCSS("background-color", "rgb(28, 25, 23)");
    await expect(primaryCta).toHaveCSS("color", "rgb(255, 255, 255)");
  });
});
