import { expect, test } from "@playwright/test";

test.describe("public map", () => {
  const transparentPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );

  test("keeps the map viewport-bound and anchors filter menus to their triggers", async ({
    page,
  }) => {
    let rasterTileRequests = 0;
    await page.route(
      /https:\/\/[abcd]\.basemaps\.cartocdn\.com\/light_all\/\d+\/\d+\/\d+\.png/,
      async (route) => {
        rasterTileRequests += 1;
        await route.fulfill({
          contentType: "image/png",
          body: transparentPng,
        });
      },
    );
    await page.goto("/map?lng=-99.8588&lat=35.8948&z=2.5");

    await expect(page.locator("footer")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Issues/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
    await expect.poll(() => rasterTileRequests).toBeGreaterThan(0);

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

  test("loads the dark basemap tiles when the device theme is dark", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    let darkRasterTileRequests = 0;
    let lightRasterTileRequests = 0;
    await page.route(
      /https:\/\/[abcd]\.basemaps\.cartocdn\.com\/(dark_all|light_all)\/\d+\/\d+\/\d+\.png/,
      async (route) => {
        if (route.request().url().includes("/dark_all/")) {
          darkRasterTileRequests += 1;
        } else {
          lightRasterTileRequests += 1;
        }
        await route.fulfill({
          contentType: "image/png",
          body: transparentPng,
        });
      },
    );

    await page.goto("/map?lng=-99.8588&lat=35.8948&z=2.5");

    await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
      .toBe("dark");
    await expect.poll(() => darkRasterTileRequests).toBeGreaterThan(0);
    expect(lightRasterTileRequests).toBe(0);
  });
});
