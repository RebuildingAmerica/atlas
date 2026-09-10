import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Proves the deployed funnel reaches Stripe with a session in the mode the
 * deployment claims to be in.
 *
 * Nothing else did. `ci / stripe-acceptance` drives the same funnel against
 * Stripe test mode, and the production deploy checks only that STRIPE_API_KEY
 * exists in Vercel, not what kind of key it is. A test key in production
 * therefore left Atlas looking configured, rendering live "Get Atlas Pro"
 * buttons, and taking no money — with every gate green.
 *
 * The session id prefix is the whole assertion: `cs_live_` means real charges,
 * `cs_test_` means none. Stripe now blocks agent-driven card entry on its
 * hosted page, so this stops at the session rather than completing a purchase.
 *
 * This creates an abandoned Checkout Session on every production deploy. They
 * expire on their own and cost nothing.
 */

interface HostedAccount {
  email: string;
  handle: string;
  name: string;
  role: "delegate" | "owner";
  userId: string;
}

interface HostedRun {
  delegate: HostedAccount;
  owner: HostedAccount;
  runId: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function helperHeaders(): Record<string, string> {
  const bypassSecret = process.env.ATLAS_HOSTED_VERCEL_BYPASS_SECRET?.trim();
  const trustedOidcToken = process.env.ATLAS_HOSTED_VERCEL_TRUSTED_OIDC_TOKEN?.trim();
  return {
    "x-atlas-hosted-e2e-secret": requiredEnv("ATLAS_HOSTED_E2E_SECRET"),
    ...(bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {}),
    ...(trustedOidcToken ? { "x-vercel-trusted-oidc-idp-token": trustedOidcToken } : {}),
  };
}

async function postHostedHelper(
  request: APIRequestContext,
  payload: Record<string, string>,
): Promise<unknown> {
  const response = await request.post("/api/e2e/hosted/identity", {
    data: payload,
    headers: helperHeaders(),
  });
  const body = await response.text();
  expect(response.status(), body).toBeLessThan(400);
  return body ? (JSON.parse(body) as unknown) : null;
}

async function signInHostedOwner(page: Page): Promise<HostedRun> {
  const run = (await postHostedHelper(page.request, {
    action: "prepare",
    runId: requiredEnv("ATLAS_HOSTED_E2E_RUN_ID"),
  })) as HostedRun;

  await postHostedHelper(page.request, {
    action: "session",
    email: run.owner.email,
    runId: run.runId,
  });

  return run;
}

/**
 * The mode the deployment says it is in.
 *
 * Defaults to live because production is the deployment this exists to guard.
 * Staging sets it to test.
 */
function expectedSessionPrefix(): "cs_live_" | "cs_test_" {
  return process.env.ATLAS_HOSTED_EXPECT_STRIPE_MODE?.trim() === "test" ? "cs_test_" : "cs_live_";
}

test("the deployed funnel opens a Stripe checkout session in the expected mode", async ({
  page,
}) => {
  test.setTimeout(3 * 60_000);

  const run = await signInHostedOwner(page);

  await page.goto("/onboarding?product=atlas_pro&interval=monthly", {
    waitUntil: "domcontentloaded",
  });

  // The workspace step always offers the naming form, and adds a "Use <name>"
  // button only when the account already has a workspace it may attach. The
  // hosted E2E helper seeds accounts and passkeys but no workspace, so which
  // one appears depends on what an earlier run left behind.
  const workspaceName = page.getByLabel("Workspace name");
  await expect(workspaceName).toBeVisible({ timeout: 60_000 });

  const useExisting = page.getByRole("button", { name: /^Use / });
  if (await useExisting.count()) {
    await expect(useExisting.first()).toBeEnabled({ timeout: 30_000 });
    await useExisting.first().click();
  } else {
    await workspaceName.fill(`Checkout proof ${run.runId}`);
    await page.getByRole("button", { name: /^Continue to payment$/ }).click();
  }

  await expect(
    page.getByText("Stripe will handle the payment details", { exact: false }),
  ).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "Continue to Stripe" }).click();
  await page.waitForURL((url) => url.hostname.endsWith("stripe.com"), { timeout: 90_000 });

  const expected = expectedSessionPrefix();
  expect(
    page.url(),
    `Checkout reached Stripe but not in ${expected === "cs_live_" ? "live" : "test"} mode: ${page.url()}`,
  ).toContain(expected);
});
