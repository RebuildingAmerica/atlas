import { expect, test } from "@playwright/test";
import { performSignIn } from "../../helpers/auth";

test.describe("admin journey", () => {
  test("should be able to access administrative pages", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Virtual authenticator support requires Chromium.");

    // Sign in
    await performSignIn(page);

    // 1. Admin Discounts Page
    await page.goto("/admin/discounts");
    await expect(page.getByRole("heading", { name: "Discount requests" })).toBeVisible();

    // 2. OAuth Consent Page
    // Note: This route might require specific query parameters to be fully functional,
    // but we can at least check if the route is accessible and has the expected heading.
    await page.goto("/oauth/consent");
    await expect(page.getByRole("heading", { name: /Authorize/i })).toBeVisible();
  });
});
