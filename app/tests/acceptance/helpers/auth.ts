import { expect, type Page } from "@playwright/test";
import { extractFirstUrlFromEmail } from "./email";

const operatorEmail = "operator@atlas.test";

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
 * Performs a magic link sign-in for the operator and returns when redirected to the account setup or organization page.
 *
 * @param page - The active Playwright page.
 */
export async function performSignIn(page: Page) {
  await resetMailbox();

  // Conditional-mediation passkey autofill on the sign-in page intercepts
  // the email input before React 19 hydration completes, blocking
  // page.fill() from propagating into form state.  Disable it for tests.
  await page.addInitScript(() => {
    if (typeof PublicKeyCredential !== "undefined") {
      Object.defineProperty(PublicKeyCredential, "isConditionalMediationAvailable", {
        configurable: true,
        value: () => Promise.resolve(false),
      });
    }
  });

  // Wait for hydration so the React onChange handler is attached before fill().
  await page.goto("/sign-in?redirect=%2Faccount", { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(operatorEmail);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByText("A sign-in link is on the way. Check your inbox.")).toBeVisible();

  const rawEmail = await pollLatestMessage(operatorEmail);
  const magicLinkUrl = extractFirstUrlFromEmail(rawEmail);
  await page.goto(magicLinkUrl);

  await page.waitForURL((url) => {
    const pathname = url.pathname;
    return pathname === "/account" || pathname === "/account-setup" || pathname === "/organization";
  });

  if (page.url().endsWith("/account-setup")) {
    await installVirtualAuthenticator(page);
    await page.getByRole("button", { name: "Add passkey" }).click();
    await page.waitForURL((url) => {
      const pathname = url.pathname;
      return pathname === "/account" || pathname === "/organization" || pathname === "/discovery";
    });
  }
}
