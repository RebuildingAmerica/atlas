import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

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

test.describe.configure({ mode: "serial" });

test("hosted ATProto identity administration works without a personal browser session", async ({
  page,
}) => {
  const run = await prepareHostedRun(page.request);

  await signInHostedAccount(page, { email: run.owner.email, runId: run.runId });
  await page.goto("/account", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();

  await page.getByRole("textbox", { name: "New Atlas handle" }).first().fill(run.owner.handle);
  await page.getByRole("button", { name: "Create Atlas identity" }).click();
  await expect(page.getByText(run.owner.handle, { exact: true })).toBeVisible({ timeout: 20_000 });

  await page.goto("/organization", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Upgrade to a team workspace/i }).click();
  await page.waitForURL(/\/pricing/, { timeout: 15_000 });
  await page.goto("/organization", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Organization identity" })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole("textbox", { name: "New Atlas handle" }).fill(organizationHandleForRun(run));
  await page.getByRole("button", { name: "Create and use Atlas identity" }).click();
  await expect(page.getByText("Organization identity updated.")).toBeVisible({
    timeout: 20_000,
  });

  await seedDelegateMembership(page, run);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("combobox", { name: "Delegate member" }).selectOption(run.delegate.userId);
  await page.getByRole("button", { name: "Grant administration" }).click();
  await expect(page.getByText("Delegated administration granted.")).toBeVisible({
    timeout: 20_000,
  });

  await signOut(page);

  await signInHostedAccount(page, { email: run.delegate.email, runId: run.runId });
  await page.goto("/organization", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Organization identity" })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Remove organization identity" }).click();
  await expect(page.getByText("Organization identity removed.")).toBeVisible({
    timeout: 20_000,
  });

  await signOut(page);

  await page.goto("/sign-in", { waitUntil: "networkidle" });
  await page.getByLabel("Email or username").fill(`@${run.owner.handle}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/account", { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
});
