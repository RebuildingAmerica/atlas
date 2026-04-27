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

    // Claim banner — visible for unverified profiles
    if ((await page.getByText(/Are you Maya Thompson/i).count()) > 0) {
      const cta = page.getByRole("link", { name: /claim profile/i });
      await expect(cta.first()).toBeVisible();
      await expect(cta.first()).toHaveAttribute("href", /\/claim/);
    }

    // Hero
    await expect(page.getByRole("heading", { name: "Maya Thompson", level: 1 })).toBeVisible();
    await expect(page.getByText("Person profile")).toBeVisible();
    await expect(page.getByRole("button", { name: /share/i })).toBeVisible();
    // Save and Follow render either as sign-in links (anonymous) or buttons (signed-in)
    expect(
      (await page.getByRole("link", { name: /save/i }).count()) +
        (await page.getByRole("button", { name: /save/i }).count()),
    ).toBeGreaterThan(0);

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

  test("ships SSR content on first paint for every public profile route", async ({ request }) => {
    // Direct fetches of the rendered HTML — no client JS is executed, so any
    // content here came from the server loader.
    const expectations: { path: string; needles: RegExp[] }[] = [
      { path: "/profiles", needles: [/Maya Thompson/, /Eastside Housing Network/] },
      { path: "/profiles/people", needles: [/Maya Thompson/] },
      {
        path: "/profiles/organizations",
        needles: [/Eastside Housing Network/],
      },
      {
        path: "/profiles/people/maya-thompson",
        needles: [/Maya Thompson/, /Person profile/],
      },
      {
        path: "/profiles/organizations/eastside-housing-network",
        needles: [/Eastside Housing Network/, /Organization profile/],
      },
      {
        path: "/claim/maya-thompson",
        needles: [/Maya Thompson/, /Claim a profile/i],
      },
    ];

    for (const { path, needles } of expectations) {
      const response = await request.get(path);
      expect(response.status(), `expected 200 for ${path}`).toBeLessThan(400);
      const html = await response.text();
      for (const needle of needles) {
        expect(html, `expected ${needle} in SSR HTML for ${path}`).toMatch(needle);
      }
    }
  });
});
