import { expect, test, type Page } from "@playwright/test";
import { extractFirstUrlFromEmail } from "../../helpers/email";

/**
 * Returns one required end-to-end environment variable.
 *
 * @param name - The environment-variable name Atlas needs for the browser run.
 */
function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for Playwright end-to-end runs.`);
  }

  return value;
}

const operatorEmail = "operator@atlas.test";
const workspaceName = "E2E Team";
const workspaceSlug = "e2e-team";
const mailboxApi = requireEnv("ATLAS_E2E_MAILBOX_URL");
const atlasApiUrl = requireEnv("ATLAS_E2E_API_URL");

/**
 * Clears the captured mailbox before the auth flow starts.
 */
async function resetMailbox() {
  const responsePromise = fetch(`${mailboxApi}/reset`, { method: "POST" });
  const response = await responsePromise;

  if (!response.ok) {
    throw new Error(`Failed to reset the test mailbox: ${response.status}`);
  }
}

/**
 * Polls the local mail-capture service until the target inbox receives a
 * message or the timeout expires.
 *
 * @param recipient - The mailbox address the end-to-end test expects.
 */
async function pollLatestMessage(recipient: string): Promise<string> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const responsePromise = fetch(
      `${mailboxApi}/messages/latest?recipient=${encodeURIComponent(recipient)}`,
    );
    const response = await responsePromise;
    const payload = (await response.json()) as { item: { raw: string } | null };
    if (payload.item?.raw) {
      return payload.item.raw;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for an end-to-end test email for ${recipient}.`);
}

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

/**
 * Completes the first-login security step, regardless of whether Atlas lands
 * on the dedicated account-setup route or the account page directly.
 *
 * @param page - The active Playwright page.
 */
async function completeInitialAccountSecurity(page: Page): Promise<void> {
  const securityRoutePromise = page.waitForURL((url) => {
    const pathname = url.pathname;
    return pathname === "/account" || pathname === "/account-setup";
  });
  await securityRoutePromise;

  const currentPath = new URL(page.url()).pathname;
  if (currentPath === "/account-setup") {
    const accountSetupHeading = page.getByRole("heading", {
      name: "Finish securing your Atlas account",
    });
    const accountSetupHeadingExpectation = expect(accountSetupHeading).toBeVisible();
    await accountSetupHeadingExpectation;
    const addPasskeyButton = page.getByRole("button", { name: "Add passkey" });
    const organizationUrlPromise = page.waitForURL("**/organization");
    const addPasskeyClickPromise = addPasskeyButton.click();
    await addPasskeyClickPromise;
    await organizationUrlPromise;
    return;
  }

  const accountHeading = page.getByRole("heading", { name: "Atlas Operator" });
  const accountHeadingExpectation = expect(accountHeading).toBeVisible();
  await accountHeadingExpectation;
  const addPasskeyButton = page.getByRole("button", { name: "Add passkey" });
  const addPasskeyClickPromise = addPasskeyButton.click();
  await addPasskeyClickPromise;
  const passkeyAddedMessage = page.getByText("Passkey added to your Atlas account.");
  const passkeyAddedExpectation = expect(passkeyAddedMessage).toBeVisible();
  await passkeyAddedExpectation;

  const organizationNavigationPromise = page.goto("/organization");
  await organizationNavigationPromise;
}

/**
 * Completes passkey re-authentication after the operator signs out.
 *
 * Atlas can either render the explicit passkey button or immediately route the
 * operator back into their account via conditional passkey autofill. The test
 * accepts either path and only fails when neither outcome happens.
 *
 * @param page - The active Playwright page.
 */
async function completePasskeyReauthentication(page: Page): Promise<void> {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const currentPath = new URL(page.url()).pathname;
    if (currentPath === "/account") {
      return;
    }

    const signInHeading = page.getByRole("heading", { name: "Sign in to Atlas" });
    const signInHeadingVisiblePromise = signInHeading.isVisible();
    const signInHeadingVisible = await signInHeadingVisiblePromise.catch(() => false);

    if (signInHeadingVisible) {
      const passkeyButton = page.getByRole("button", { name: "Sign in with passkey" });
      const passkeyButtonExpectation = expect(passkeyButton).toBeVisible();
      await passkeyButtonExpectation;
      const accountUrlPromise = page.waitForURL("**/account");
      const passkeyClickPromise = passkeyButton.click();
      await passkeyClickPromise;
      await accountUrlPromise;
      return;
    }

    const waitForTickPromise = page.waitForTimeout(200);
    await waitForTickPromise;
  }

  throw new Error("Atlas did not complete passkey re-authentication.");
}

/**
 * Enables a virtual authenticator so Chromium can exercise the passkey flow.
 *
 * @param page - The active Playwright page.
 */
async function installVirtualAuthenticator(page: Page) {
  const context = page.context();
  const clientPromise = context.newCDPSession(page);
  const client = await clientPromise;
  const enablePromise = client.send("WebAuthn.enable");
  await enablePromise;
  const addAuthenticatorPromise = client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      automaticPresenceSimulation: true,
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      protocol: "ctap2",
      transport: "internal",
    },
  });
  await addAuthenticatorPromise;
}

test.describe.configure({ mode: "serial" });

test("auth e2e: magic link, passkey, api key, and protected discovery all work", async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== "chromium", "Virtual authenticator support requires Chromium.");

  const installAuthenticatorPromise = installVirtualAuthenticator(page);
  await installAuthenticatorPromise;
  const resetMailboxPromise = resetMailbox();
  await resetMailboxPromise;

  const signInNavigationPromise = page.goto("/sign-in?redirect=%2Faccount");
  await signInNavigationPromise;
  const signInHeading = page.getByRole("heading", { name: "Sign in to Atlas" });
  const signInHeadingExpectation = expect(signInHeading).toBeVisible();
  await signInHeadingExpectation;
  const emailInput = page.getByLabel("Email");
  const emailInputClickPromise = emailInput.click();
  await emailInputClickPromise;
  const enterEmailPromise = emailInput.pressSequentially(operatorEmail);
  await enterEmailPromise;
  const emailValueExpectation = expect(emailInput).toHaveValue(operatorEmail);
  await emailValueExpectation;
  const continueWithEmailButton = page.getByRole("button", { name: "Continue with email" });
  const continueButtonExpectation = expect(continueWithEmailButton).toBeEnabled();
  await continueButtonExpectation;
  const continueWithEmailClickPromise = continueWithEmailButton.click();
  await continueWithEmailClickPromise;
  const magicLinkStatus = page.getByText(
    "If the email can access Atlas, a sign-in link is on the way.",
  );
  const magicLinkStatusExpectation = expect(magicLinkStatus).toBeVisible();
  await magicLinkStatusExpectation;

  const rawEmail = await pollLatestMessage(operatorEmail);
  const magicLinkUrl = extractFirstUrlFromEmail(rawEmail);
  const magicLinkNavigationPromise = page.goto(magicLinkUrl);
  await magicLinkNavigationPromise;
  const completeSecurityPromise = completeInitialAccountSecurity(page);
  await completeSecurityPromise;
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
  const completePasskeyReauthenticationPromise = completePasskeyReauthentication(page);
  await completePasskeyReauthenticationPromise;
  const thirdAccountHeadingExpectation = expect(secondAccountHeading).toBeVisible();
  await thirdAccountHeadingExpectation;
});
