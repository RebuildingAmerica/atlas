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
  test("keeps search and results controls usable at phone width", async ({ page }) => {
    await stubBasemap(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/map?lng=-115.14&lat=36.17&z=9");

    const search = page.getByRole("combobox", { name: "Search a place or find an actor" });
    await expect(search).toBeVisible();
    await search.click();
    await expect(search).toBeFocused();
    await search.fill("Las Vegas");
    await expect(search).toHaveValue("Las Vegas");
    await search.press("Escape");

    const results = page.getByRole("button", { name: "Show map results" });
    await expect(results).toBeVisible();
    const listSwitch = page.getByRole("link", { name: "List view" });
    const listBounds = await listSwitch.boundingBox();
    const resultsBounds = await results.boundingBox();
    expect(listBounds).not.toBeNull();
    expect(resultsBounds).not.toBeNull();
    if (listBounds && resultsBounds) {
      expect(resultsBounds.y).toBeGreaterThanOrEqual(listBounds.y + listBounds.height);
    }
    await page.setViewportSize({ width: 320, height: 568 });
    const narrowListBounds = await listSwitch.boundingBox();
    const narrowResultsBounds = await results.boundingBox();
    expect(narrowListBounds).not.toBeNull();
    expect(narrowResultsBounds).not.toBeNull();
    if (narrowListBounds && narrowResultsBounds) {
      expect(narrowResultsBounds.y).toBeGreaterThanOrEqual(
        narrowListBounds.y + narrowListBounds.height,
      );
      expect(narrowResultsBounds.x + narrowResultsBounds.width).toBeLessThanOrEqual(320);
    }
    await results.click();
    await expect(page.getByRole("button", { name: "Hide map results" })).toBeVisible();
  });

  test("keeps a selected map actor visible after switching to the list", async ({ page }) => {
    await stubBasemap(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const apiUrl = process.env.ATLAS_E2E_API_URL;
    if (!apiUrl) throw new Error("ATLAS_E2E_API_URL is required for the map journey.");
    const response = await page.request.get(
      new URL(
        "/api/entities/map?min_lng=-125&min_lat=24&max_lng=-66.5&max_lat=49.5",
        apiUrl,
      ).toString(),
    );
    expect(response.ok()).toBe(true);
    const data = (await response.json()) as {
      points: { id: string; lat: number; lng: number; name: string }[];
    };
    const actor = data.points[0];
    expect(actor).toBeDefined();
    if (!actor) {
      return;
    }

    await page.goto(
      `/map?selected=${encodeURIComponent(actor.id)}&lng=${actor.lng}&lat=${actor.lat}&z=8`,
    );
    const panel = page.getByRole("dialog", { name: actor.name });
    await expect(panel).toBeVisible();
    await expect(page.getByRole("button", { name: "Show map results" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Skip to selected profile" })).toHaveAttribute(
      "href",
      "#map-detail-panel",
    );
    await panel.getByRole("link", { name: "List view" }).click();

    await expect(page).toHaveURL(/\/browse\?/);
    expect(new URL(page.url()).searchParams.get("selected")).toBe(actor.id);
    await expect(page.getByRole("region", { name: "Selected on map" })).toContainText(actor.name);
    await expect(page.locator("#selected-map-result")).toHaveCount(1);
  });

  test("switches between map and list without losing a Las Vegas search or camera", async ({
    page,
  }) => {
    await stubBasemap(page);
    await page.goto("/map?states=NV&issue_areas=housing_affordability&lng=-115.14&lat=36.17&z=9");

    await page.getByRole("link", { name: "List view" }).click();
    await expect(page).toHaveURL(/\/browse\?/);
    const listUrl = new URL(page.url());
    expect(listUrl.searchParams.get("states")).toBe("NV");
    expect(listUrl.searchParams.get("issue_areas")).toBe("housing_affordability");
    expect(listUrl.searchParams.get("lng")).toBe("-115.14");
    expect(listUrl.searchParams.get("lat")).toBe("36.17");
    expect(listUrl.searchParams.get("z")).toBe("9");

    await page
      .getByRole("region", { name: "Browse tools" })
      .getByRole("link", { name: "Map" })
      .click();
    await expect(page).toHaveURL(/\/map\?/);
    const mapUrl = new URL(page.url());
    expect(mapUrl.searchParams.get("states")).toBe("NV");
    expect(mapUrl.searchParams.get("issue_areas")).toBe("housing_affordability");
    expect(mapUrl.searchParams.get("lng")).toBe("-115.14");
    expect(mapUrl.searchParams.get("lat")).toBe("36.17");
    expect(mapUrl.searchParams.get("z")).toBe("9");
  });

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
