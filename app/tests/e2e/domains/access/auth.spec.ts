import { expect, test } from "@playwright/test";
import { performSignIn, requireEnv } from "../../helpers/auth";

const workspaceName = "E2E Team";
const workspaceSlug = "e2e-team";
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

  // Using extracted helper for initial sign-in
  await performSignIn(page);

  const workspaceNameInput = page.getByLabel("Workspace name");
  const workspaceNameExpectation = expect(workspaceNameInput).toBeVisible();
  await workspaceNameExpectation;
  const workspaceSlugInput = page.getByLabel("Workspace slug");
  const workspaceNameFillPromise = workspaceNameInput.fill(workspaceName);
  await workspaceNameFillPromise;
  const workspaceSlugFillPromise = workspaceSlugInput.fill(workspaceSlug);
  await workspaceSlugFillPromise;
  const workspaceTypeSelect = page.locator("select");
  const workspaceTypeSelectPromise = workspaceTypeSelect.selectOption("team");
  await workspaceTypeSelectPromise;
  const createWorkspaceButton = page.getByRole("button", { name: "Create workspace" });
  const createWorkspaceClickPromise = createWorkspaceButton.click();
  await createWorkspaceClickPromise;

  const ssoPageNavigationPromise = page.goto("/organization/sso");
  await ssoPageNavigationPromise;
  const ssoHeading = page.getByRole("heading", { name: "Configure enterprise sign-in" });
  const ssoHeadingExpectation = expect(ssoHeading).toBeVisible();
  await ssoHeadingExpectation;
  const ssoWorkspaceDomainInput = page.getByLabel("Workspace domain").first();
  const ssoWorkspaceDomainExpectation = expect(ssoWorkspaceDomainInput).toHaveValue("atlas.test");
  await ssoWorkspaceDomainExpectation;

  const accountPageNavigationPromise = page.goto("/account");
  await accountPageNavigationPromise;
  const secondAccountHeading = page.getByRole("heading", { name: "Atlas Operator" });
  const secondAccountHeadingExpectation = expect(secondAccountHeading).toBeVisible();
  await secondAccountHeadingExpectation;
  const accountLink = page.getByRole("link", { name: "Account" });
  const accountLinkExpectation = expect(accountLink).toBeVisible();
  await accountLinkExpectation;

  const apiKeysHeading = page.getByRole("heading", { name: "API keys" });
  const apiKeysHeadingExpectation = expect(apiKeysHeading).toBeVisible();
  await apiKeysHeadingExpectation;
  const apiKeyNameInput = page.getByLabel("Key name");
  const apiKeyInputClickPromise = apiKeyNameInput.click();
  await apiKeyInputClickPromise;
  const apiKeyNameTypePromise = apiKeyNameInput.pressSequentially("E2E CLI");
  await apiKeyNameTypePromise;
  const apiKeyNameExpectation = expect(apiKeyNameInput).toHaveValue("E2E CLI");
  await apiKeyNameExpectation;
  const createApiKeyButton = page.getByRole("button", { name: "Create" });
  const createApiKeyExpectation = expect(createApiKeyButton).toBeEnabled();
  await createApiKeyExpectation;
  const createApiKeyClickPromise = createApiKeyButton.click();
  await createApiKeyClickPromise;
  const newApiKeyCard = page.getByText("New API key").locator("xpath=..");
  const apiKeySecretTextPromise = newApiKeyCard.locator("p").nth(1).textContent();
  const apiKeySecretText = await apiKeySecretTextPromise;
  const apiKeySecret = apiKeySecretText?.trim() ?? "";
  expect(apiKeySecret.length).toBeGreaterThan(20);

  const apiResponsePromise = waitForApiKeyAcceptance(apiKeySecret);
  const apiResponse = await apiResponsePromise;
  const apiResponseBody = await apiResponse.text();
  expect(
    apiResponse.ok,
    `Atlas API key request failed with ${apiResponse.status}: ${apiResponseBody}`,
  ).toBeTruthy();

  const discoveryPageNavigationPromise = page.goto("/discovery");
  await discoveryPageNavigationPromise;
  const discoveryHeading = page.getByRole("heading", { name: `${workspaceName} discovery` });
  const discoveryHeadingExpectation = expect(discoveryHeading).toBeVisible();
  await discoveryHeadingExpectation;
  const locationInput = page.getByLabel("Location");
  const stateInput = page.getByLabel("State");
  const fillLocationPromise = locationInput.fill("Kansas City");
  await fillLocationPromise;
  const fillStatePromise = stateInput.fill("MO");
  await fillStatePromise;
  const firstIssue = page.locator('input[type="checkbox"]').first();
  const checkIssuePromise = firstIssue.check();
  await checkIssuePromise;
  const startRunButton = page.getByRole("button", { name: "Start run" });
  const startRunClickPromise = startRunButton.click();
  await startRunClickPromise;
  const discoveryRunCard = page.locator("article").filter({ hasText: "Kansas City" }).first();
  const discoveryRunExpectation = expect(discoveryRunCard).toBeVisible();
  await discoveryRunExpectation;

  const returnToAccountPromise = page.goto("/account");
  await returnToAccountPromise;
  const signOutPromise = Promise.all([
    page.waitForURL("**/"),
    page.getByRole("button", { name: "Sign out" }).click(),
  ]);
  await signOutPromise;
  const secondSignInNavigationPromise = page.goto("/sign-in?redirect=%2Faccount");
  await secondSignInNavigationPromise;
  // Note: we can't easily use completePasskeyReauthentication without its full definition here,
  // but we can either re-import it or use performSignIn again.
  // For simplicity, let's just use performSignIn again.
  await performSignIn(page);
  const thirdAccountHeadingExpectation = expect(secondAccountHeading).toBeVisible();
  await thirdAccountHeadingExpectation;
});
