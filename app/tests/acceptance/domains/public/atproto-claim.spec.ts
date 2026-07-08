import { expect, test, type Page } from "@playwright/test";
import { performSignIn } from "../../helpers/auth";

const organizationSlug = "eastside-housing-network";
const organizationDomain = "eastsidehousing.org";
const representativeHandle = "eastsidehousing.bsky.social";

test.describe("ATProto profile verification handoff", () => {
  test("connects an ATProto account through the local OAuth route harness", async ({ page }) => {
    await performSignIn(page);

    await openOrganizationVerification(page);

    const identityId = await connectAtprotoAccount(page, representativeHandle);
    await page.getByRole("textbox", { name: "Organization domain" }).fill(organizationDomain);
    await fulfillProfileVerificationSubmission(page);

    const submissionRequest = waitForVerificationSubmission(page);
    await page.getByRole("button", { name: "Submit verification" }).click();
    const submittedBody = (await submissionRequest).postDataJSON() as unknown;
    expect(submittedBody).toMatchObject({
      atproto_identity_id: identityId,
      dns_domain: organizationDomain,
      relationship: "organization_representative",
    });
  });

  test("drops the connected ATProto identity when the handle changes", async ({ page }) => {
    await performSignIn(page);

    await openOrganizationVerification(page);
    await connectAtprotoAccount(page, representativeHandle);

    await page.getByRole("textbox", { name: "ATProto handle" }).fill("different.bsky.social");
    await fulfillProfileVerificationSubmission(page);

    const submissionRequest = waitForVerificationSubmission(page);
    await page.getByRole("button", { name: "Submit verification" }).click();
    const submittedBody = (await submissionRequest).postDataJSON() as Record<string, unknown>;
    expect(submittedBody).not.toHaveProperty("atproto_identity_id");
    expect(submittedBody).toMatchObject({
      relationship: "organization_representative",
    });
  });

  test("returns failed ATProto verification to the organization verification page", async ({
    page,
  }) => {
    await performSignIn(page);

    await openOrganizationVerification(page);
    const callbackUrl = await startAtprotoConnection(page, representativeHandle);
    callbackUrl.searchParams.set("handle", "different.bsky.social");

    await page.goto(callbackUrl.toString());

    await expect(page).toHaveURL((url) => {
      return (
        url.pathname === `/claim/${organizationSlug}` &&
        url.searchParams.get("atprotoError") === "ATProto identity could not be verified." &&
        url.searchParams.get("atprotoHandle") === representativeHandle
      );
    });
    await expect(page.getByRole("alert")).toHaveText("ATProto identity could not be verified.");
    await expect(page.getByRole("textbox", { name: "ATProto handle" })).toHaveValue(
      representativeHandle,
    );

    await connectAtprotoAccount(page, representativeHandle);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page).toHaveURL((url) => {
      return (
        url.pathname === `/claim/${organizationSlug}` &&
        url.searchParams.get("atprotoHandle") === representativeHandle &&
        url.searchParams.has("atprotoIdentityId") &&
        !url.searchParams.has("atprotoError")
      );
    });
  });
});

async function openOrganizationVerification(page: Page): Promise<void> {
  await page.goto(`/claim/${organizationSlug}`);
  await expect(page.getByRole("heading", { name: "Eastside Housing Network" })).toBeVisible();
}

async function connectAtprotoAccount(page: Page, handle: string): Promise<string> {
  await page.getByRole("textbox", { name: "ATProto handle" }).fill(handle);
  const startResponse = waitForOAuthResponse(page, "/api/atproto/oauth/start");
  const authorizeResponse = waitForOAuthResponse(page, "/api/atproto/oauth/harness/authorize");
  const callbackResponse = waitForOAuthResponse(page, "/api/atproto/oauth/callback");
  await page.getByRole("button", { name: "Connect ATProto" }).click();

  expect((await startResponse).status()).toBe(302);
  expect((await authorizeResponse).status()).toBe(302);
  expect((await callbackResponse).status()).toBe(302);

  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === `/claim/${organizationSlug}` &&
      url.searchParams.has("atprotoIdentityId") &&
      url.searchParams.get("atprotoHandle") === handle
    );
  });
  const returnedUrl = new URL(page.url());
  const identityId = returnedUrl.searchParams.get("atprotoIdentityId");
  if (!identityId) {
    throw new Error("ATProto OAuth harness did not return an identity id.");
  }
  return identityId;
}

async function startAtprotoConnection(page: Page, handle: string): Promise<URL> {
  const startUrl = new URL("/api/atproto/oauth/start", page.url());
  startUrl.searchParams.set("handle", handle);
  startUrl.searchParams.set("returnTo", `/claim/${organizationSlug}`);
  const response = await page.request.get(startUrl.toString(), { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  const location = response.headers().location;
  if (!location) {
    throw new Error("ATProto OAuth start route did not return a provider location.");
  }
  return new URL(location, page.url());
}

function waitForOAuthResponse(page: Page, pathname: string) {
  return page.waitForResponse((response) => {
    return new URL(response.url()).pathname === pathname;
  });
}

async function fulfillProfileVerificationSubmission(page: Page): Promise<void> {
  await page.route(`**/api/profiles/${organizationSlug}/claim`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        id: "claim_e2e",
        entry_id: "entry_eastside",
        entry_name: "Eastside Housing Network",
        entry_slug: organizationSlug,
        status: "pending",
        tier: 2,
        user_id: "user_e2e",
        user_email: "person@example.org",
        evidence: {},
        proofs: [],
        created_at: "2026-07-07T12:00:00Z",
        updated_at: "2026-07-07T12:00:00Z",
      },
      status: 200,
    });
  });
}

function waitForVerificationSubmission(page: Page) {
  return page.waitForRequest(`**/api/profiles/${organizationSlug}/claim`);
}
