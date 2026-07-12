import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { extractFirstUrlFromEmail } from "./email";

/**
 * Returns one required end-to-end environment variable.
 *
 * @param name - The environment-variable name Atlas needs for the browser run.
 */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for Playwright end-to-end runs.`);
  }

  return value;
}

const mailboxApi = requireEnv("ATLAS_E2E_MAILBOX_URL");

interface SignInOptions {
  createWorkspace?: boolean;
  email?: string;
}

function createAccountEmail(): string {
  return `person+${randomUUID()}@atlas.test`;
}

async function createReadyWorkspace(page: Page) {
  if (new URL(page.url()).pathname !== "/organization") {
    await page.goto("/organization", { waitUntil: "networkidle" });
  }

  if ((await page.getByRole("heading", { name: "Create your workspace" }).count()) === 0) {
    return;
  }

  const workspaceId = randomUUID().slice(0, 8);
  await page.getByText("Individual workspace", { exact: false }).first().click();
  await page.getByLabel("Workspace name").fill(`E2E Workspace ${workspaceId}`);
  await page.getByLabel("Workspace slug").fill(`e2e-${workspaceId}`);
  await expect(page.getByText("Slug is available.")).toBeVisible({ timeout: 30_000 });
  const createButton = page.getByRole("button", { name: "Create workspace" });
  await expect(createButton).toBeEnabled({ timeout: 15_000 });
  await createButton.click();
  await expect(page.getByText("Workspace created.")).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle");
}

/**
 * Clears the captured mailbox before the auth flow starts.
 */
export async function resetMailbox() {
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
export async function pollLatestMessage(recipient: string): Promise<string> {
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
 * Enables a virtual authenticator so Chromium can exercise the passkey flow.
 *
 * @param page - The active Playwright page.
 */
export async function installVirtualAuthenticator(page: Page) {
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

/**
 * Performs a magic-link sign-in and returns when redirected to the account setup or organization page.
 *
 * @param page - The active Playwright page.
 */
export async function performSignIn(
  page: Page,
  options: SignInOptions = {},
): Promise<{ email: string }> {
  const accountEmail = options.email ?? createAccountEmail();
  await installVirtualAuthenticator(page);

  // Wait for hydration so the React onChange handler is attached before fill().
  await page.goto("/sign-in?redirect=%2Faccount", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Can't use a passkey?" }).click();
  const emailInput = page.getByLabel("Email");
  await emailInput.fill(accountEmail);
  await expect(emailInput).toHaveValue(accountEmail);
  const continueButton = page.getByRole("button", { name: "Continue with email" });
  await expect(continueButton).toBeEnabled({ timeout: 15_000 });
  await continueButton.click();
  await expect(page.getByText("A sign-in link is on the way. Check your inbox.")).toBeVisible();

  const rawEmail = await pollLatestMessage(accountEmail);
  const magicLinkUrl = extractFirstUrlFromEmail(rawEmail);
  await page.goto(magicLinkUrl);

  await page.waitForURL((url) => {
    const pathname = url.pathname;
    return pathname === "/account" || pathname === "/setup" || pathname === "/organization";
  });
  await page.waitForLoadState("networkidle");

  if (new URL(page.url()).pathname === "/setup") {
    await page.getByRole("button", { name: "Add passkey" }).click();
    await page.waitForURL((url) => {
      const pathname = url.pathname;
      return pathname === "/account" || pathname === "/organization" || pathname === "/discovery";
    });
    await page.waitForLoadState("networkidle");
  }

  if (options.createWorkspace) {
    await createReadyWorkspace(page);
  }

  return { email: accountEmail };
}
