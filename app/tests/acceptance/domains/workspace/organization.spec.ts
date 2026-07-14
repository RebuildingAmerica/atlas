import { expect, test } from "@playwright/test";
import { performSignIn } from "../../helpers/auth";

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
    await expect(page.getByRole("heading", { name: "Organization ATProto identity" })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("textbox", { name: "New Atlas handle" }).fill("workspace.atlas.test");
    await page.getByRole("button", { name: "Create and use Atlas identity" }).click();

    await expect(page.getByText("Organization ATProto identity updated.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("p").filter({ hasText: /^workspace\.atlas\.test$/ })).toBeVisible();
  });
});
