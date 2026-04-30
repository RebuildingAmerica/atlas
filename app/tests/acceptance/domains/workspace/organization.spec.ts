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
    // A signed-in operator without a workspace yet sees the workspace setup
    // surface; once the solo workspace is auto-created they see workspace
    // management copy.  Either is the right place for this test.
    await expect(
      page
        .getByRole("heading", { name: /(Workspace setup|Workspace management|workspace)/i })
        .first(),
    ).toBeVisible();

    await page.goto("/organization/sso");
    // Free-tier operators without the auth.sso capability see the
    // gated "Enterprise sign-in" header; team-tier operators see
    // "Configure enterprise sign-in".  Either header is the right
    // landing for this test.
    await expect(
      page
        .getByRole("heading", { name: /(Configure enterprise sign-in|Enterprise sign-in)/ })
        .first(),
    ).toBeVisible();
  });
});
