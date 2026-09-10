import { expect, type Page, test } from "@playwright/test";

import { imagePath, writeCaptureResult } from "./capture-result";
import type { CaptureStatus, ScreenshotWait } from "./manifest-types";
import { preparePage, settlePage } from "./prepare-page";
import { CAPTURE_ROUTES } from "./route-manifest";

const mode = process.env.ATLAS_SCREENSHOTS_MODE === "session" ? "session" : "local";
const liveTiles = process.env.ATLAS_SCREENSHOTS_LIVE_TILES === "1";
const DEFAULT_WAIT: ScreenshotWait = { kind: "settled" };

test.describe.configure({ mode: "parallel" });

function withSearch(path: string, search: Readonly<Record<string, string>> | undefined): string {
  if (search === undefined) {
    return path;
  }

  const params = new URLSearchParams(search);
  return `${path}?${params.toString()}`;
}

/**
 * Resolves a path whose parameter is a seed-time id by following a link from an index page.
 *
 * @param page - The page to navigate.
 * @param fromPath - The index page listing the resource.
 * @param linkHrefPattern - `RegExp` source matched against candidate anchors' pathnames.
 * @returns The discovered pathname.
 */
async function discoverPath(
  page: Page,
  fromPath: string,
  linkHrefPattern: string,
): Promise<string> {
  await page.goto(fromPath, { waitUntil: "networkidle" });
  const pattern = new RegExp(linkHrefPattern);
  const hrefs = await page
    .locator("a[href]")
    .evaluateAll((anchors) =>
      anchors.map((anchor) => (anchor as HTMLAnchorElement).getAttribute("href") ?? ""),
    );

  for (const href of hrefs) {
    const pathname = href.startsWith("http") ? new URL(href).pathname : (href.split("?")[0] ?? "");
    if (pathname !== "" && pattern.test(pathname)) {
      return pathname;
    }
  }

  throw new Error(`No link matching ${linkHrefPattern} found on ${fromPath}.`);
}

for (const route of CAPTURE_ROUTES.filter((candidate) => candidate.mode === mode)) {
  test(route.name, async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
      failedRequests.push(`${request.method()} ${request.url()}`);
    });

    await preparePage(page, liveTiles);

    const started = Date.now();
    let requestedPath = route.path ?? "";
    let httpStatus: number | null = null;
    let fontsLoaded = false;
    let error: string | null = null;

    try {
      if (route.path === undefined) {
        const discovery = route.discovery;
        if (discovery === undefined) {
          throw new Error(`${route.name} declares neither path nor discovery.`);
        }
        requestedPath = await discoverPath(page, discovery.fromPath, discovery.linkHrefPattern);
      }

      const url = withSearch(requestedPath, route.search);
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      httpStatus = response?.status() ?? null;

      const settled = await settlePage(
        page,
        route.wait ?? DEFAULT_WAIT,
        route.frame ?? "full-page",
      );
      fontsLoaded = settled.fontsLoaded;
    } catch (caught) {
      // A page that errors is exactly what the audit needs to see, so fall through and capture.
      error = caught instanceof Error ? caught.message : String(caught);
    }

    const finalPathname = new URL(page.url()).pathname;
    const expectedPathname = route.expectPathname ?? requestedPath;

    await page.screenshot({
      animations: "disabled",
      fullPage: (route.frame ?? "full-page") === "full-page",
      mask: (route.mask ?? []).map((selector) => page.locator(selector)),
      maskColor: "#e5e5e5",
      path: imagePath(route.name),
    });

    // A page that is *meant* to answer non-200 also logs its own status as a failed resource
    // load. Discount that one line so a correct page is not reported as a defect.
    const statusIsExpected =
      route.expectHttpStatus !== undefined && httpStatus === route.expectHttpStatus;
    const meaningfulConsoleErrors = statusIsExpected
      ? consoleErrors.filter((message) => !message.startsWith("Failed to load resource"))
      : consoleErrors;

    let status: CaptureStatus = "ok";
    if (error !== null) {
      status = "failed";
    } else if (finalPathname !== expectedPathname) {
      status = "redirected";
    } else if (pageErrors.length > 0 || meaningfulConsoleErrors.length > 0) {
      status = "degraded";
    }

    await writeCaptureResult({
      consoleErrors: meaningfulConsoleErrors,
      durationMs: Date.now() - started,
      error,
      failedRequests,
      finalPathname,
      fontsLoaded,
      httpStatus,
      mode,
      name: route.name,
      note: route.note ?? null,
      pageErrors,
      requestedPath,
      routeId: route.routeId,
      status,
    });

    // Soft so the PNG and sidecar always survive, but the run still reports the mismatch.
    expect.soft(finalPathname, `${route.name} landed on an unexpected path`).toBe(expectedPathname);
    expect.soft(error, `${route.name} failed to load`).toBeNull();
  });
}
