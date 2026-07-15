import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { absoluteHostedUrl, expectedHostedPublicOrigin } from "../helpers/hosted-endpoints";

interface HostedIdentityAccount {
  email: string;
  handle: string;
  name: string;
  role: "delegate" | "owner";
  userId: string;
}

interface HostedIdentityRun {
  delegate: HostedIdentityAccount;
  owner: HostedIdentityAccount;
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
  return {
    "x-atlas-hosted-e2e-secret": requiredEnv("ATLAS_HOSTED_E2E_SECRET"),
    ...(process.env.ATLAS_HOSTED_VERCEL_BYPASS_SECRET?.trim()
      ? {
          "x-vercel-protection-bypass": process.env.ATLAS_HOSTED_VERCEL_BYPASS_SECRET.trim(),
        }
      : {}),
    ...(process.env.ATLAS_HOSTED_VERCEL_TRUSTED_OIDC_TOKEN?.trim()
      ? {
          "x-vercel-trusted-oidc-idp-token":
            process.env.ATLAS_HOSTED_VERCEL_TRUSTED_OIDC_TOKEN.trim(),
        }
      : {}),
  };
}

function compactHostedRunId(runId: string): string {
  return runId.replace(/[^a-z0-9]/g, "").slice(-12);
}

function handleSuffix(handle: string): string {
  const [, ...suffixParts] = handle.split(".");
  if (suffixParts.length === 0) {
    throw new Error(`Cannot derive handle suffix from ${handle}.`);
  }
  return suffixParts.join(".");
}

function organizationHandleForRun(run: HostedIdentityRun): string {
  return `a${compactHostedRunId(run.runId)}g.${handleSuffix(run.owner.handle)}`;
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

async function prepareHostedRun(request: APIRequestContext): Promise<HostedIdentityRun> {
  return (await postHostedHelper(request, {
    action: "prepare",
    runId: requiredEnv("ATLAS_HOSTED_E2E_RUN_ID"),
  })) as HostedIdentityRun;
}

async function signInHostedAccount(
  page: Page,
  input: {
    email: string;
    runId: string;
  },
): Promise<void> {
  await postHostedHelper(page.request, {
    action: "session",
    email: input.email,
    runId: input.runId,
  });
}

async function seedDelegateMembership(page: Page, run: HostedIdentityRun): Promise<void> {
  await postHostedHelper(page.request, {
    action: "member",
    delegateEmail: run.delegate.email,
    runId: run.runId,
  });
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Profile menu" }).click();
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/"),
    page.getByRole("button", { name: "Sign out" }).click(),
  ]);
}

async function visitHostedRoute(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
}

async function openOrganizationIdentityControls(page: Page): Promise<void> {
  await visitHostedRoute(page, "/organization");

  const identityHeading = page.getByRole("heading", { name: "Organization identity" });
  const upgradeButton = page.getByRole("button", { name: /Upgrade to a team workspace/i });
  await expect(identityHeading.or(upgradeButton)).toBeVisible({ timeout: 20_000 });

  if (await identityHeading.isVisible()) {
    return;
  }

  await upgradeButton.click();
  await Promise.race([
    page.waitForURL(/\/pricing/, { timeout: 20_000 }).catch(() => null),
    identityHeading.waitFor({ state: "visible", timeout: 20_000 }).catch(() => null),
  ]);

  await visitHostedRoute(page, "/organization");
  await expect(identityHeading).toBeVisible({ timeout: 20_000 });
}

async function createManagedIdentityFromField(
  page: Page,
  inputName: string,
  buttonName: string,
  handle: string,
): Promise<void> {
  const input = page.getByRole("textbox", { name: inputName }).first();
  const button = page.getByRole("button", { name: buttonName });

  await expect(input).toBeVisible({ timeout: 20_000 });
  await expect(input).toBeEditable({ timeout: 20_000 });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await input.fill(handle);
    await expect(input).toHaveValue(handle, { timeout: 5_000 });
    if (await button.isEnabled()) {
      break;
    }
    await page.waitForTimeout(500);
  }

  await expect(input).toHaveValue(handle, { timeout: 5_000 });
  await expect(button).toBeEnabled({ timeout: 5_000 });
  await button.click();
}

test.describe.configure({ mode: "serial" });

test("hosted ATProto identity administration works without a personal browser session", async ({
  page,
}) => {
  const run = await prepareHostedRun(page.request);

  await signInHostedAccount(page, { email: run.owner.email, runId: run.runId });
  await visitHostedRoute(page, "/account");
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();

  await createManagedIdentityFromField(
    page,
    "New Atlas handle",
    "Create Atlas identity",
    run.owner.handle,
  );
  await expect(page.getByText(run.owner.handle, { exact: true })).toBeVisible({ timeout: 20_000 });

  await openOrganizationIdentityControls(page);

  await createManagedIdentityFromField(
    page,
    "New Atlas handle",
    "Create and use Atlas identity",
    organizationHandleForRun(run),
  );
  await expect(page.getByText("Organization identity updated.")).toBeVisible({
    timeout: 20_000,
  });

  await seedDelegateMembership(page, run);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("combobox", { name: "Delegate member" }).selectOption(run.delegate.userId);
  await page.getByRole("button", { name: "Grant administration" }).click();
  await expect(page.getByText("Delegated administration granted.")).toBeVisible({
    timeout: 20_000,
  });

  await signOut(page);

  await signInHostedAccount(page, { email: run.delegate.email, runId: run.runId });
  await visitHostedRoute(page, "/organization");
  await expect(page.getByRole("heading", { name: "Organization identity" })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Remove organization identity" }).click();
  await expect(page.getByText("Organization identity removed.")).toBeVisible({
    timeout: 20_000,
  });

  await signOut(page);

  const signInOrigin = expectedHostedPublicOrigin();
  await page.goto(absoluteHostedUrl(signInOrigin, "/sign-in"), { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email or username").fill(`@${run.owner.handle}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL((url) => url.origin === signInOrigin && url.pathname === "/account", {
    timeout: 20_000,
  });
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
});
