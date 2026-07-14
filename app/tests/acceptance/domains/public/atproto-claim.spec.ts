import { expect, test, type Page } from "@playwright/test";
import { performSignIn } from "../../helpers/auth";

const organizationSlug = "eastside-housing-network";
const organizationDomain = "eastsidehousing.org";
const representativeHandle = "eastsidehousing.bsky.social";
const draftHandle = "eastsidehousing-draft.bsky.social";
const recoveryHandle = "eastsidehousing-recovery.bsky.social";
const personSlug = "maya-thompson";

test.describe("ATProto profile verification handoff", () => {
  test("submits a person identity claim for review", async ({ page }) => {
    await performSignIn(page);
    await page.goto(`/claim/${personSlug}`);
    await expect(page.getByRole("heading", { name: "Maya Thompson" })).toBeVisible();
    const identityId = await connectAtprotoAccount(page, "maya-claim.bsky.social", personSlug);

    const request = page.waitForRequest(`**/api/profiles/${personSlug}/claim`);
    const submission = page.waitForResponse(`**/api/profiles/${personSlug}/claim`);
    await page.getByRole("button", { name: "Submit verification" }).click();
    const response = await submission;
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status(), JSON.stringify(body)).toBe(201);
    expect((await request).postDataJSON()).toMatchObject({ atproto_identity_id: identityId });
    expect(body).toMatchObject({ status: "pending" });
  });

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

  test("restores the selected identity from the callback into the claim draft", async ({
    page,
  }) => {
    await performSignIn(page);

    await openOrganizationVerification(page);
    await connectAtprotoAccount(page, draftHandle);

    await page.reload();
    await expect(page.getByRole("combobox", { name: "ATProto identity" })).not.toHaveValue("");
    await page.getByRole("textbox", { name: "Organization domain" }).fill(organizationDomain);
    await fulfillProfileVerificationSubmission(page);

    const submissionRequest = waitForVerificationSubmission(page);
    await page.getByRole("button", { name: "Submit verification" }).click();
    const submittedBody = (await submissionRequest).postDataJSON() as Record<string, unknown>;
    expect(submittedBody).toMatchObject({ relationship: "organization_representative" });
    expect(submittedBody).toHaveProperty("atproto_identity_id");
  });

  test("returns failed ATProto verification to the organization verification page", async ({
    page,
  }) => {
    await performSignIn(page);

    await openOrganizationVerification(page);
    const callbackUrl = await startAtprotoConnection(page, recoveryHandle);
    callbackUrl.searchParams.set("handle", "different.bsky.social");

    await page.goto(callbackUrl.toString());

    await expect(page).toHaveURL((url) => {
      return (
        url.pathname === `/claim/${organizationSlug}` &&
        url.searchParams.get("atprotoError") === "ATProto identity could not be verified."
      );
    });
    await expect(page.getByRole("alert")).toHaveText("ATProto identity could not be verified.");
    await expect(page.getByRole("textbox", { name: "Another ATProto handle" })).toHaveValue("");

    await connectAtprotoAccount(page, recoveryHandle);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page).toHaveURL((url) => {
      return (
        url.pathname === `/claim/${organizationSlug}` &&
        url.searchParams.has("atprotoIdentityId") &&
        !url.searchParams.has("atprotoError")
      );
    });
  });

  test("lets a verified steward replace and remove a public identity", async ({ page }) => {
    await performSignIn(page);
    await mockPersonIdentityState(page, "verified");
    await page.route("**/api/atproto/identities", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
            connected_at: "2026-07-12T12:00:00Z",
            control_status: "active",
            current_handle: "new.example",
            did: "did:plc:new",
            id: "identity-new",
            profiles: [],
            resolution_status: "verified",
            verified_at: "2026-07-12T12:00:00Z",
          },
        ],
      });
    });
    const replacement = page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        request.url().endsWith(`/api/profiles/${personSlug}/atproto-identity`),
    );
    await page.route(`**/api/profiles/${personSlug}/atproto-identity`, async (route) => {
      if (route.request().method() === "DELETE") {
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        json: {
          current_handle: "new.example",
          did: "did:plc:new",
          identity_id: "identity-new",
          status: "verified",
          verified_at: "2026-07-12T12:00:00Z",
        },
      });
    });

    await page.goto(`/manage/${personSlug}`);
    await page.getByRole("combobox", { name: "ATProto identity" }).selectOption("identity-new");
    await page.getByRole("button", { name: "Replace identity" }).click();
    await page.getByRole("button", { name: "Replace", exact: true }).click();
    expect((await replacement).postDataJSON()).toMatchObject({
      atproto_identity_id: "identity-new",
      replace: true,
    });

    const removal = page.waitForRequest(
      (request) =>
        request.method() === "DELETE" &&
        request.url().endsWith(`/api/profiles/${personSlug}/atproto-identity`),
    );
    await page.getByRole("button", { name: "Remove identity" }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await removal;
    await expect(page.getByText("Public identity removed.")).toBeVisible();
  });
});

async function mockPersonIdentityState(
  page: Page,
  linkedStatus: "verified" | "needs_attention",
): Promise<void> {
  await page.route(`**/api/entities/by-slug/people/${personSlug}`, async (route) => {
    const response = await route.fetch();
    const record = (await response.json()) as Record<string, unknown> & {
      claim?: Record<string, unknown>;
    };
    record.claim = {
      ...(record.claim ?? {}),
      linked_atproto_did: "did:plc:old",
      linked_atproto_handle: "old.example",
      linked_atproto_status: linkedStatus,
      linked_atproto_verified_at: "2026-07-12T12:00:00Z",
      status: "verified",
      verification_level: "subject-verified",
    };
    await route.fulfill({ json: record, status: response.status() });
  });
}

async function openOrganizationVerification(page: Page): Promise<void> {
  await page.goto(`/claim/${organizationSlug}`);
  await expect(page.getByRole("heading", { name: "Eastside Housing Network" })).toBeVisible();
}

async function connectAtprotoAccount(
  page: Page,
  handle: string,
  slug = organizationSlug,
): Promise<string> {
  await page.getByRole("textbox", { name: "Another ATProto handle" }).fill(handle);
  const startResponse = waitForOAuthResponse(page, "/api/atproto/oauth/start");
  const authorizeResponse = waitForOAuthResponse(page, "/api/atproto/oauth/harness/authorize");
  const callbackResponse = waitForOAuthResponse(page, "/api/atproto/oauth/callback");
  await page.getByRole("button", { name: "Connect another account" }).click();

  expect((await startResponse).status()).toBe(302);
  expect((await authorizeResponse).status()).toBe(302);
  expect((await callbackResponse).status()).toBe(302);

  await expect(page).toHaveURL((url) => {
    return url.pathname === `/claim/${slug}` && url.searchParams.has("atprotoIdentityId");
  });
  const returnedUrl = new URL(page.url());
  const identityId = returnedUrl.searchParams.get("atprotoIdentityId");
  if (!identityId) {
    throw new Error("ATProto OAuth harness did not return an identity id.");
  }
  return identityId;
}

async function startAtprotoConnection(
  page: Page,
  handle: string,
  slug = organizationSlug,
): Promise<URL> {
  const startUrl = new URL("/api/atproto/oauth/start", page.url());
  startUrl.searchParams.set("handle", handle);
  startUrl.searchParams.set("returnTo", `/claim/${slug}`);
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
