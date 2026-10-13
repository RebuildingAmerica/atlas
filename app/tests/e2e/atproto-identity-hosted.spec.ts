import { test } from "../helpers/hosted-test";
import { hostedPublicRequestInit } from "../helpers/hosted-endpoints";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
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
  return Object.fromEntries(
    new Headers(
      hostedPublicRequestInit({
        headers: {
          "x-atlas-hosted-e2e-secret": requiredEnv("ATLAS_HOSTED_E2E_SECRET"),
        },
      }).headers,
    ).entries(),
  );
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

async function authorizeOneHostedAtprotoSignIn(page: Page, origin: string): Promise<void> {
  await page.route(
    `${origin}/api/atproto/sign-in/start?*`,
    async (route) => {
      // Let the browser follow the server's redirect. Fulfilling an intercepted
      // navigation with a fetched 302 can leave its next request pending.
      await route.continue({
        headers: {
          ...route.request().headers(),
          "x-atlas-hosted-e2e-secret": requiredEnv("ATLAS_HOSTED_E2E_SECRET"),
        },
      });
    },
    { times: 1 },
  );
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

async function fillFieldAndClickWhenEnabled(
  page: Page,
  inputName: string,
  buttonName: string,
  handle: string,
): Promise<void> {
  const input = page.getByRole("textbox", { name: inputName }).first();
  const button = page.getByRole("button", { name: buttonName });

  await expect(input).toBeVisible({ timeout: 20_000 });
  await expect(input).toBeEditable({ timeout: 20_000 });

  const readyDeadline = Date.now() + 5_000;
  do {
    await input.fill(handle);
    await expect(input).toHaveValue(handle, { timeout: 5_000 });
    if (await button.isEnabled()) {
      break;
    }
    await page.waitForTimeout(250);
  } while (Date.now() < readyDeadline);

  await expect(input).toHaveValue(handle, { timeout: 5_000 });
  await expect(button).toBeEnabled({ timeout: 5_000 });
  await button.click();
}

// Each test prepares and cleans up its own accounts. Run every journey even
// when another fails so identity administration cannot hide Save regressions.
test.describe.configure({ mode: "default" });

// A failed browser assertion or partially completed preparation still owns
// disposable accounts. The independent request fixture survives page failures.
test.afterEach(async ({ request }) => {
  const runId = requiredEnv("ATLAS_HOSTED_E2E_RUN_ID");
  const result = await postHostedHelper(request, { action: "cleanup", runId });
  expect(result).toMatchObject({ ok: true, runId });
});

interface HostedSavedList {
  id: string;
  name: string;
  user_id: string;
}

test("signed-in profile saves survive reload and stay private to their owner", async ({ page }) => {
  const run = await prepareHostedRun(page.request);
  const listName = `Hosted Save ${compactHostedRunId(run.runId)}`;
  const publicHeaders = Object.fromEntries(
    new Headers(hostedPublicRequestInit().headers).entries(),
  );
  await signInHostedAccount(page, { email: run.owner.email, runId: run.runId });
  try {
    await visitHostedRoute(page, "/profiles/organizations/housing-california-f25e");
    await expect(
      page.getByRole("heading", { name: "Housing California", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Save to list" });
    await picker.getByRole("button", { name: "Create a new list" }).click();
    await picker.getByLabel("List name").fill(listName);
    const itemSaved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /^\/api\/lists\/[^/]+\/items$/.test(new URL(response.url()).pathname),
    );
    await picker.getByRole("button", { name: "Create", exact: true }).click();
    expect((await itemSaved).status()).toBe(201);
    await expect(
      picker.getByRole("button", { name: new RegExp(`^${listName}(?:\\s|$)`) }),
    ).toHaveAttribute("aria-pressed", "true");
    await visitHostedRoute(page, "/lists");
    await page.getByRole("link", { name: new RegExp(listName) }).click();
    await expect(page.getByRole("link", { name: "Housing California", exact: true })).toBeVisible();
    const savedUrl = new URL(page.url()).pathname;
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: "Housing California", exact: true })).toBeVisible();
    await signInHostedAccount(page, { email: run.delegate.email, runId: run.runId });
    await visitHostedRoute(page, "/lists");
    await expect(
      page.getByRole("heading", { name: "Your research lists", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(listName) })).toHaveCount(0);
    const denied = await page.request.get(`/api${savedUrl}`, { headers: publicHeaders });
    expect([403, 404]).toContain(denied.status());
  } finally {
    await signInHostedAccount(page, { email: run.owner.email, runId: run.runId });
    const response = await page.request.get("/api/lists", { headers: publicHeaders });
    expect(response.status()).toBe(200);
    const lists = (await response.json()) as HostedSavedList[];
    for (const list of lists.filter(
      (item) => item.name === listName && item.user_id === run.owner.userId,
    )) {
      const removed = await page.request.delete(`/api/lists/${encodeURIComponent(list.id)}`, {
        headers: publicHeaders,
      });
      expect(removed.status()).toBe(204);
    }
  }
});

test("hosted ATProto identity administration works without a personal browser session", async ({
  page,
}) => {
  const run = await prepareHostedRun(page.request);

  await signInHostedAccount(page, { email: run.owner.email, runId: run.runId });
  await visitHostedRoute(page, "/account");
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();

  await fillFieldAndClickWhenEnabled(
    page,
    "New Atlas handle",
    "Create Atlas identity",
    run.owner.handle,
  );
  await expect(page.getByText(run.owner.handle, { exact: true })).toBeVisible({ timeout: 20_000 });

  await openOrganizationIdentityControls(page);

  await fillFieldAndClickWhenEnabled(
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
  await authorizeOneHostedAtprotoSignIn(page, signInOrigin);
  // The form is server-rendered with an empty controlled value. Wait for React
  // to attach its change handler before filling it, or the DOM can show the
  // handle while application state still leaves Continue disabled.
  await page.goto(absoluteHostedUrl(signInOrigin, "/sign-in"), { waitUntil: "networkidle" });
  const harnessAuthorizeRequest = page.waitForRequest(
    (request) => {
      const url = new URL(request.url());
      return url.origin === signInOrigin && url.pathname === "/api/atproto/oauth/harness/authorize";
    },
    { timeout: 20_000 },
  );
  const harnessCallbackRequest = page.waitForRequest(
    (request) => {
      const url = new URL(request.url());
      return url.origin === signInOrigin && url.pathname === "/api/atproto/oauth/callback";
    },
    { timeout: 20_000 },
  );
  await fillFieldAndClickWhenEnabled(page, "Email or username", "Continue", `@${run.owner.handle}`);
  const providerRequests = await Promise.all([harnessAuthorizeRequest, harnessCallbackRequest]);
  for (const request of providerRequests) {
    expect((await request.allHeaders())["x-atlas-hosted-e2e-secret"]).toBeUndefined();
  }
  await page.waitForURL((url) => url.origin === signInOrigin && url.pathname === "/account", {
    timeout: 20_000,
  });
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
});
