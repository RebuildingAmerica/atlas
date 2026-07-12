import { expect, test } from "@playwright/test";
import { performSignIn } from "../../helpers/auth";

test.describe("admin journey", () => {
  test("should be able to access administrative pages", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Virtual authenticator support requires Chromium.");

    await performSignIn(page, { createWorkspace: true, email: "person@atlas.test" });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Service health" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Review profile verifications" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Review discounts" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Inspect cloud costs" })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(page.getByText("Service health")).toBeVisible();

    await page.goto("/admin/discounts");
    await expect(
      page
        .getByText(/Discount verifications|Loading|Discount verifications could not load/)
        .first(),
    ).toBeVisible();

    await page.goto("/oauth/consent?client_id=e2e-unknown-client");
    await expect(page.getByRole("heading", { name: /Allow access to Atlas/ })).toBeVisible();
  });
});
