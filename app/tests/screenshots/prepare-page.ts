import type { Page } from "@playwright/test";

import type { ScreenshotFrame, ScreenshotWait } from "./manifest-types";

// The browser clock is deliberately NOT pinned. Atlas renders dates during SSR using the
// server's real time, so overriding the clock in the page makes hydration disagree with the
// server HTML and React reports a mismatch on every page that formats a date. The seed uses
// absolute dates, so captures stay stable enough without it, and a report free of self-
// inflicted errors is worth more than perfectly identical relative timestamps.

const STATIC_STYLES = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: -1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    scroll-behavior: auto !important;
    caret-color: transparent !important;
  }
  ::-webkit-scrollbar { display: none !important; }
`;

/**
 * Installs everything that must be in place before the first navigation.
 *
 * @param page - The page about to be driven.
 * @param liveTiles - When true, real basemap tiles are fetched instead of the stub.
 */
export async function preparePage(page: Page, liveTiles: boolean): Promise<void> {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.addInitScript((css: string) => {
    const apply = () => {
      const style = document.createElement("style");
      style.setAttribute("data-atlas-screenshots", "");
      style.textContent = css;
      document.head.append(style);
    };
    if (document.head) {
      apply();
    } else {
      document.addEventListener("DOMContentLoaded", apply, { once: true });
    }
  }, STATIC_STYLES);

  // Analytics beacons never render anything but do keep the network busy. Fulfilled rather
  // than aborted so they do not show up as console errors and mask real ones.
  await page.route("**/_vercel/**", (route) =>
    route.fulfill({ body: "", contentType: "text/plain", status: 204 }),
  );

  if (!liveTiles) {
    // An empty vector tile draws no geography, which keeps screenshots stable
    // without reaching OpenFreeMap.
    await page.route("**tiles.openfreemap.org/planet/**", (route) =>
      route.fulfill({ body: Buffer.alloc(0), contentType: "application/x-protobuf", status: 200 }),
    );
    await page.route("**tiles.openfreemap.org/planet", (route) =>
      route.fulfill({
        body: JSON.stringify({
          tilejson: "3.0.0",
          tiles: ["https://tiles.openfreemap.org/planet/stub/{z}/{x}/{y}.pbf"],
        }),
        contentType: "application/json",
        status: 200,
      }),
    );
    await page.route("**tiles.openfreemap.org/fonts/**", (route) =>
      route.fulfill({ body: Buffer.alloc(0), contentType: "application/x-protobuf", status: 200 }),
    );
  }
}

async function waitForAnchor(page: Page, wait: ScreenshotWait): Promise<void> {
  switch (wait.kind) {
    case "selector":
      await page.locator(wait.selector).first().waitFor({ state: "visible", timeout: 20_000 });
      return;
    case "role":
      await page
        .getByRole(wait.role as Parameters<Page["getByRole"]>[0], { name: wait.name })
        .first()
        .waitFor({ state: "visible", timeout: 20_000 });
      return;
    case "map":
      await page
        .locator("canvas.maplibregl-canvas")
        .first()
        .waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForFunction(
        () => {
          const canvas = document.querySelector("canvas.maplibregl-canvas");
          return canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0;
        },
        undefined,
        { timeout: 30_000 },
      );
      return;
    case "settled":
      await page.waitForLoadState("networkidle", { timeout: 30_000 });
  }
}

async function waitForImages(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const pending = Array.from(document.images)
      .filter((image) => !image.complete)
      .map(
        (image) =>
          new Promise<void>((resolve) => {
            image.addEventListener(
              "load",
              () => {
                resolve();
              },
              { once: true },
            );
            image.addEventListener(
              "error",
              () => {
                resolve();
              },
              { once: true },
            );
          }),
      );
    await Promise.all(pending);
  });
}

/**
 * Scrolls the full scroll height so lazy, viewport-triggered content mounts.
 *
 * Without this, `IntersectionObserver`-driven sections are blank in a full-page capture.
 *
 * @param page - The page being captured.
 */
async function revealLazyContent(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = window.innerHeight;
    const total = document.body.scrollHeight;
    for (let offset = 0; offset < total; offset += step) {
      window.scrollTo(0, offset);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    window.scrollTo(0, 0);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

export interface SettleResult {
  fontsLoaded: boolean;
}

/**
 * Brings a loaded page to a visually stable state and reports whether webfonts arrived.
 *
 * @param page - The page being captured.
 * @param wait - The route's declared readiness anchor.
 * @param frame - Whether the capture will stitch the full scroll height.
 * @returns Whether the primary webfont resolved; false means every capture in the run is
 *   rendering with fallback type and the audit should not be trusted on typography.
 */
export async function settlePage(
  page: Page,
  wait: ScreenshotWait,
  frame: ScreenshotFrame,
): Promise<SettleResult> {
  await waitForAnchor(page, wait);
  await page.evaluate(() => document.fonts.ready);

  if (frame === "full-page") {
    await revealLazyContent(page);
  }

  await waitForImages(page);
  const fontsLoaded = await page.evaluate(() => document.fonts.check('16px "Public Sans"'));
  return { fontsLoaded };
}
