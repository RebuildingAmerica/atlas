import { expect, test } from "@playwright/test";
import { performSignIn } from "../../helpers/auth";

test.describe("organization management journey", () => {
  test("should be able to view organization and navigate to sso", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Virtual authenticator support requires Chromium.");

    // Sign in
    await performSignIn(page);

    // 1. Organization Page
    await page.goto("/organization");
    await expect(page.getByRole("heading", { name: "Organization" })).toBeVisible();

    // Check for members section
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();

    // 2. Navigate to SSO
    const ssoLink = page.getByRole("link", { name: "Single sign-on" });
    await ssoLink.click();
    await expect(page).toHaveURL(/\/organization\/sso/);
    await expect(page.getByRole("heading", { name: "Configure enterprise sign-in" })).toBeVisible();
  });
});
