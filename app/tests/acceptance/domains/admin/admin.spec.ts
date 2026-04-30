import { expect, test } from "@playwright/test";
import { performSignIn } from "../../helpers/auth";

test.describe("admin journey", () => {
  test("should be able to access administrative pages", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Virtual authenticator support requires Chromium.");

    await performSignIn(page);

    await page.goto("/admin/discounts");
    await expect(
      page
        .getByText(
          /Discount Verification Cohorts|Loading verifications|Failed to load verifications/,
        )
        .first(),
    ).toBeVisible();

    await page.goto("/oauth/consent?client_id=e2e-unknown-client");
    await expect(page.getByRole("heading", { name: /Allow access to Atlas/ })).toBeVisible();
  });
});
