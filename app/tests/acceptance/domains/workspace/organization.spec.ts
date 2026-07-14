import { expect, test, type Page } from "@playwright/test";
import { performSignIn } from "../../helpers/auth";

interface SeededWorkspaceMember {
  email: string;
  name: string;
  userId: string;
}

async function seedWorkspaceMember(page: Page): Promise<SeededWorkspaceMember> {
  const secret = process.env.ATLAS_E2E_INTERNAL_SECRET?.trim();
  if (!secret) {
    throw new Error("ATLAS_E2E_INTERNAL_SECRET must be set for workspace member seeding.");
  }

  const response = await page.request.post("/api/e2e/workspace/member", {
    data: { email: "delegate@atlas.test", name: "Delegate One" },
    headers: { "x-atlas-e2e-secret": secret },
  });
  const responseBody = await response.text();
  expect(response.status(), responseBody).toBe(201);
  return JSON.parse(responseBody) as SeededWorkspaceMember;
}

test.describe("organization management journey", () => {
  test("should be able to view the workspace landing page and navigate to sso", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Virtual authenticator support requires Chromium.");

    await performSignIn(page);

    await page.goto("/organization");
    // A signed-in account without a workspace yet sees the workspace setup
    // surface; once the solo workspace is auto-created they see workspace
    // management copy.  Either is the right place for this test.
    await expect(
      page
        .getByRole("heading", { name: /(Workspace setup|Workspace management|workspace)/i })
        .first(),
    ).toBeVisible();

    await page.goto("/organization/sso");
    // Free-tier accounts without the auth.sso capability see the
    // gated "Enterprise sign-in" header; team-tier accounts see
    // "Configure enterprise sign-in".  Either header is the right
    // landing for this test.
    await expect(
      page
        .getByRole("heading", { name: /(Configure enterprise sign-in|Enterprise sign-in)/ })
        .first(),
    ).toBeVisible();
  });

  test("creates an Atlas-managed organization identity from the workspace page", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Virtual authenticator support requires Chromium.");

    await performSignIn(page);
    await page.goto("/organization", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Upgrade to a team workspace/i }).click();
    await page.waitForURL(/\/pricing/, { timeout: 15_000 });
    await page.goto("/organization", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Organization identity" })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("textbox", { name: "New Atlas handle" }).fill("workspace.atlas.test");
    await page.getByRole("button", { name: "Create and use Atlas identity" }).click();

    await expect(page.getByText("Organization identity updated.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("p").filter({ hasText: /^workspace\.atlas\.test$/ })).toBeVisible();
  });

  test("grants delegated identity administration, lets the delegate remove it, then denies revoked access", async ({
    page,
    browser,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Virtual authenticator support requires Chromium.");

    await performSignIn(page);
    await page.goto("/organization", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Upgrade to a team workspace/i }).click();
    await page.waitForURL(/\/pricing/, { timeout: 15_000 });
    await page.goto("/organization", { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: "New Atlas handle" }).fill("delegate-flow.atlas.test");
    await page.getByRole("button", { name: "Create and use Atlas identity" }).click();
    await expect(page.getByText("Organization identity updated.")).toBeVisible({
      timeout: 15_000,
    });

    const member = await seedWorkspaceMember(page);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("combobox", { name: "Delegate member" }).selectOption(member.userId);
    await page.getByRole("button", { name: "Grant administration" }).click();
    await expect(page.getByText("Delegated administration granted.")).toBeVisible({
      timeout: 15_000,
    });

    const delegateContext = await browser.newContext({
      baseURL: process.env.ATLAS_E2E_APP_URL?.trim() || "http://localhost:3100",
    });
    const delegatePage = await delegateContext.newPage();
    await performSignIn(delegatePage, { email: member.email });
    await delegatePage.goto("/organization", { waitUntil: "networkidle" });
    await expect(delegatePage.getByRole("heading", { name: "Organization identity" })).toBeVisible({
      timeout: 15_000,
    });
    await delegatePage.getByRole("button", { name: "Remove organization identity" }).click();
    await expect(delegatePage.getByText("Organization identity removed.")).toBeVisible({
      timeout: 15_000,
    });

    await page.goto("/organization", { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: "New Atlas handle" }).fill("revoked-flow.atlas.test");
    await page.getByRole("button", { name: "Create and use Atlas identity" }).click();
    await expect(page.getByText("Organization identity updated.")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("combobox", { name: "Delegate member" }).selectOption(member.userId);
    await page.getByRole("button", { name: "Grant administration" }).click();
    await expect(page.getByText("Delegated administration granted.")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Revoke Delegate One" }).click();
    await expect(page.getByText("Delegated administration revoked for Delegate One.")).toBeVisible({
      timeout: 15_000,
    });

    await delegatePage.goto("/organization", { waitUntil: "networkidle" });
    await expect(delegatePage.getByRole("heading", { name: "Organization identity" })).toHaveCount(
      0,
    );
    await delegateContext.close();
  });
});
