import { expect, test } from "@playwright/test";

test.describe("public profile routes", () => {
  test("should browse real seeded people and organization profiles", async ({ page }) => {
    await page.goto("/profiles");

    const mayaLink = page
      .locator('a[href="/profiles/people/maya-thompson"]')
      .filter({ hasText: "Maya Thompson" })
      .first();
    await expect(mayaLink).toBeVisible();

    await page.goto("/profiles/people/maya-thompson");
    await expect(page.getByRole("heading", { name: "Maya Thompson" })).toBeVisible();
    await expect(page.getByText("What Atlas has surfaced")).toBeVisible();
    await expect(page.getByText("Reporting trail")).toBeVisible();
    await expect(page.getByText("Hide Error")).toHaveCount(0);

    await page.goto("/profiles/organizations/eastside-housing-network");
    await expect(page.getByRole("heading", { name: "Eastside Housing Network" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Issue footprint" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Appearances and coverage" })).toBeVisible();
    await expect(page.getByText("Hide Error")).toHaveCount(0);
  });

  test("should render a proper not-found page for missing profile slugs", async ({ page }) => {
    await page.goto("/profiles/people/maya-thompson-preview");

    await expect(page.getByText("404 · Page not found")).toBeVisible();
    await expect(page.getByRole("heading", { name: /We lost the map/i })).toBeVisible();
    await expect(page.getByText("Hide Error")).toHaveCount(0);
    await expect(page.getByText(/Entity not found/i)).toHaveCount(0);
  });
});
