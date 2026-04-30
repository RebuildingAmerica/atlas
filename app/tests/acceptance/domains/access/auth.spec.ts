import { expect, test } from "@playwright/test";
import { performSignIn, requireEnv } from "../../helpers/auth";

const atlasApiUrl = requireEnv("ATLAS_E2E_API_URL");

/**
 * Polls the protected Atlas API until a fresh key is accepted or the timeout
 * expires.
 *
 * @param apiKey - The raw API key secret captured from the account page.
 */
async function waitForApiKeyAcceptance(apiKey: string): Promise<Response> {
  const deadline = Date.now() + 20_000;
  let lastFailure = "no response received";

  while (Date.now() < deadline) {
    const responsePromise = fetch(`${atlasApiUrl}/api/discovery-runs`, {
      headers: {
        "X-API-Key": apiKey,
      },
    });
    const response = await responsePromise;
    if (response.ok) {
      return response;
    }

    const responseBodyPromise = response.text();
    const responseBody = await responseBodyPromise;
    lastFailure = `${response.status}: ${responseBody}`;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `Timed out waiting for Atlas to accept the API key. Last response: ${lastFailure}`,
  );
}

test.describe.configure({ mode: "serial" });

test("auth e2e: magic link, passkey, api key, and protected discovery all work", async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== "chromium", "Virtual authenticator support requires Chromium.");

  await performSignIn(page);

  await page.waitForURL((url) => url.pathname === "/account");
  await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();

  const apiKeyNameInput = page.getByLabel("Key name");
  await apiKeyNameInput.fill("E2E CLI");
  await page.getByRole("button", { name: "Create" }).click();

  const apiKeySecret = (
    (await page
      .getByText(/^[A-Za-z0-9_-]{24,}$/)
      .first()
      .textContent()) ?? ""
  ).trim();
  expect(apiKeySecret.length).toBeGreaterThan(20);

  const apiResponse = await waitForApiKeyAcceptance(apiKeySecret);
  const apiResponseBody = await apiResponse.text();
  expect(
    apiResponse.ok,
    `Atlas API key request failed with ${apiResponse.status}: ${apiResponseBody}`,
  ).toBeTruthy();

  await page.goto("/discovery");
  await page.getByLabel("Location").fill("Kansas City");
  await page.getByLabel("State").fill("MO");
  await page.locator('input[type="checkbox"]').first().check();
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page.locator("article").filter({ hasText: "Kansas City" }).first()).toBeVisible();

  await page.goto("/account");
  await Promise.all([
    page.waitForURL("**/"),
    page.getByRole("button", { name: "Sign out" }).click(),
  ]);

  await performSignIn(page);
  await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();
});
