import { expect, test, type Page } from "@playwright/test";
import { performSignIn } from "../../helpers/auth";

const personSlug = "maya-thompson";

test.describe("ATProto profile verification handoff", () => {
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
