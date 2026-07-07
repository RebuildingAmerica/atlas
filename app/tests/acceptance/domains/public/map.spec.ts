import { expect, test } from "@playwright/test";
import { ATLAS_BASEMAP_STYLE_URL } from "../../../../src/domains/catalog/map/map-config";

test.describe("public map", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(ATLAS_BASEMAP_STYLE_URL, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          version: 8,
          sources: {},
          layers: [
            {
              id: "atlas-e2e-basemap",
              type: "background",
              paint: {
                "background-color": "#e8e0d3",
              },
            },
          ],
        }),
      });
    });
  });

  test("keeps the map viewport-bound and anchors filter menus to their triggers", async ({
    page,
  }) => {
    await page.goto("/map?lng=-99.8588&lat=35.8948&z=2.5");

    await expect(page.locator("footer")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Issues/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();

    await expect
      .poll(async () => page.evaluate(() => document.scrollingElement?.scrollHeight))
      .toBe(await page.evaluate(() => window.innerHeight));

    await page.getByRole("button", { name: /Issues/ }).click();
    await expect(page.getByRole("group", { name: "Issues" })).toBeVisible();

    await page.getByRole("button", { name: /Types/ }).click();
    await expect(page.getByRole("group", { name: "Types" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Issues" })).toHaveCount(0);

    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("z")).not.toBe("2.5");
  });
});
