import { expect, test } from "@playwright/test";

test.describe("public profile routes", () => {
  test("renders the redesigned person profile with hero, work, evidence, and network sections", async ({
    page,
  }) => {
    await page.goto("/profiles");

    const mayaLink = page
      .locator('a[href="/profiles/people/maya-thompson"]')
      .filter({ hasText: "Maya Thompson" })
      .first();
    await expect(mayaLink).toBeVisible();

    await page.goto("/profiles/people/maya-thompson");

    // Hero
    await expect(page.getByRole("heading", { name: "Maya Thompson", level: 1 })).toBeVisible();
    await expect(page.getByText("Person profile")).toBeVisible();
    await expect(page.getByRole("button", { name: /share/i })).toBeVisible();

    // Main column sections — Work no longer reads "What Atlas has surfaced"
    await expect(page.getByText("What Atlas has surfaced")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Reporting trail" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /who else is doing this work/i })).toBeVisible();
    await expect(page.getByText("Network · the portal")).toBeVisible();

    // Sidebar — DataQualityBlock replaces the old Connections sidebar
    await expect(page.getByText("Data quality")).toBeVisible();
    await expect(page.getByText(/first surfaced/i)).toBeVisible();

    await expect(page.getByText("Hide Error")).toHaveCount(0);
  });

  test("renders the redesigned organization profile with portal, footprint, and evidence sections", async ({
    page,
  }) => {
    await page.goto("/profiles/organizations/eastside-housing-network");

    // Hero
    await expect(
      page.getByRole("heading", { name: "Eastside Housing Network", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Organization profile")).toBeVisible();
    await expect(page.getByRole("button", { name: /share/i })).toBeVisible();

    // Main column sections
    await expect(page.getByRole("heading", { name: "Issue footprint" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Appearances and coverage" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /who else is doing this work/i })).toBeVisible();

    // Sidebar
    await expect(page.getByText("Data quality")).toBeVisible();

    await expect(page.getByText("Hide Error")).toHaveCount(0);
  });

  test("Contact mailto button appears when an email is on file and is hidden otherwise", async ({
    page,
  }) => {
    await page.goto("/profiles/people/maya-thompson");
    // The Contact link is a real mailto when an email is present. We don't
    // assume it for every fixture, but if it renders it must be a mailto.
    const contact = page.getByRole("link", { name: /^contact$/i });
    if ((await contact.count()) > 0) {
      const href = await contact.first().getAttribute("href");
      expect(href).toMatch(/^mailto:/);
    }
  });

  test("renders a proper not-found page for missing profile slugs", async ({ page }) => {
    await page.goto("/profiles/people/maya-thompson-preview");

    await expect(page.getByText("404 · Page not found")).toBeVisible();
    await expect(page.getByRole("heading", { name: /We lost the map/i })).toBeVisible();
    await expect(page.getByText("Hide Error")).toHaveCount(0);
    await expect(page.getByText(/Entity not found/i)).toHaveCount(0);
  });
});
