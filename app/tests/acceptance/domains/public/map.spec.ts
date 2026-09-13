import { expect, test, type Page } from "@playwright/test";

const TILEJSON_URL = "https://tiles.openfreemap.org/planet";
const STUB_TILE_TEMPLATE = "https://tiles.openfreemap.org/planet/stub/{z}/{x}/{y}.pbf";

/**
 * Serves the basemap offline: a TileJSON pointing at stub tiles, and an empty
 * vector tile for every request, counting how many the map asked for.
 */
async function stubBasemap(page: Page): Promise<() => number> {
  let vectorTileRequests = 0;
  await page.route(TILEJSON_URL, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        tilejson: "3.0.0",
        tiles: [STUB_TILE_TEMPLATE],
        minzoom: 0,
        maxzoom: 14,
      }),
    }),
  );
  await page.route(
    /https:\/\/tiles\.openfreemap\.org\/planet\/stub\/\d+\/\d+\/\d+\.pbf/,
    (route) => {
      vectorTileRequests += 1;
      return route.fulfill({ contentType: "application/x-protobuf", body: Buffer.alloc(0) });
    },
  );
  await page.route(/https:\/\/tiles\.openfreemap\.org\/fonts\//, (route) =>
    route.fulfill({ contentType: "application/x-protobuf", body: Buffer.alloc(0) }),
  );
  return () => vectorTileRequests;
}

test.describe("public map", () => {
  test("keeps the map viewport-bound and anchors filter menus to their triggers", async ({
    page,
  }) => {
    const vectorTileRequests = await stubBasemap(page);
    await page.goto("/map?lng=-99.8588&lat=35.8948&z=2.5");

    await expect(page.locator("footer")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Issues/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
    await expect.poll(vectorTileRequests).toBeGreaterThan(0);

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

  test("draws the basemap under the dark device theme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    const vectorTileRequests = await stubBasemap(page);

    await page.goto("/map?lng=-99.8588&lat=35.8948&z=2.5");

    await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
      .toBe("dark");
    await expect.poll(vectorTileRequests).toBeGreaterThan(0);
  });
});
