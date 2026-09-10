import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Proves the deployed funnel opens a Stripe session in the mode the deployment
 * claims. The session id prefix is the assertion: `cs_live_` means real
 * charges, `cs_test_` means none.
 *
 * It stops at the session because Stripe blocks agent-driven card entry on its
 * hosted page. Each run leaves one abandoned Checkout Session, which expires.
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

/** The mode the deployment claims. Staging sets this to test. */
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

  // The step always offers the naming form, and adds "Use <name>" when the
  // account already has a workspace to attach.
  const workspaceName = page.getByLabel("Workspace name");
  await expect(workspaceName).toBeVisible({ timeout: 60_000 });

  // Both buttons stay disabled until the purchase intent lands.
  const useExisting = page.getByRole("button", { name: /^Use / });
  const createWorkspace = page.getByRole("button", { name: /^Continue to payment$/ });
  await expect(useExisting.or(createWorkspace).first()).toBeEnabled({ timeout: 60_000 });

  if ((await useExisting.count()) && (await useExisting.first().isEnabled())) {
    await useExisting.first().click();
  } else {
    await workspaceName.fill(`Checkout proof ${run.runId}`);
    await createWorkspace.click();
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
