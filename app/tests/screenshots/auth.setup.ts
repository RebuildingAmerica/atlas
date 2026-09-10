import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { expect, test } from "@playwright/test";

import {
  createReadyWorkspace,
  installVirtualAuthenticator,
  pollLatestMessage,
  resetMailbox,
} from "../acceptance/helpers/auth";
import { extractFirstUrlFromEmail } from "../acceptance/helpers/email";
import { STORAGE_STATE, imagePath, writeCaptureResult } from "./capture-result";
import { preparePage, settlePage } from "./prepare-page";

/**
 * The operator address. It matches `ATLAS_OPERATOR_ALLOWED_EMAILS`, which is what unlocks the
 * `/admin/*` pages — those are gated at the data layer, not by a route guard.
 */
const OPERATOR_EMAIL = "person@atlas.test";

const liveTiles = process.env.ATLAS_SCREENSHOTS_LIVE_TILES === "1";

/**
 * Signs in once and captures `/setup`, which is only reachable mid-flow.
 *
 * `requireIncompleteAtlasSession` bounces a finished account straight out of `/setup`, so the
 * only honest way to photograph it is here, between the magic link and the passkey.
 */
test("authenticate", async ({ page }) => {
  test.setTimeout(180_000);

  await preparePage(page, liveTiles);
  await resetMailbox();
  await installVirtualAuthenticator(page);

  await page.goto("/sign-in?redirect=%2Faccount", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Can't use a passkey?" }).click();
  const emailInput = page.getByLabel("Email");
  await emailInput.fill(OPERATOR_EMAIL);
  await expect(emailInput).toHaveValue(OPERATOR_EMAIL);
  const continueButton = page.getByRole("button", { name: "Continue with email" });
  await expect(continueButton).toBeEnabled({ timeout: 15_000 });
  await continueButton.click();
  await expect(page.getByText("A sign-in link is on the way. Check your inbox.")).toBeVisible();

  const rawEmail = await pollLatestMessage(OPERATOR_EMAIL);
  await page.goto(extractFirstUrlFromEmail(rawEmail));
  await page.waitForURL((url) => ["/account", "/setup", "/organization"].includes(url.pathname));
  await page.waitForLoadState("networkidle");

  if (new URL(page.url()).pathname === "/setup") {
    const settled = await settlePage(page, { kind: "settled" }, "full-page");
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: imagePath("setup-passkey"),
    });
    await writeCaptureResult({
      consoleErrors: [],
      durationMs: 0,
      error: null,
      failedRequests: [],
      finalPathname: "/setup",
      fontsLoaded: settled.fontsLoaded,
      httpStatus: 200,
      mode: "session",
      name: "setup-passkey",
      note: "Captured mid-sign-in; a completed account cannot reach /setup.",
      pageErrors: [],
      requestedPath: "/setup",
      routeId: "/setup",
      status: "ok",
    });

    await page.getByRole("button", { name: "Add a passkey" }).click();
    await page.waitForURL((url) =>
      ["/account", "/organization", "/discovery"].includes(url.pathname),
    );
    await page.waitForLoadState("networkidle");
  }

  await createReadyWorkspace(page);

  await mkdir(dirname(STORAGE_STATE), { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE });
});
