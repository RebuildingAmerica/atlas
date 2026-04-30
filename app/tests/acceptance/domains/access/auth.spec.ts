import { expect, test } from "@playwright/test";
import { performSignIn } from "../../helpers/auth";

test.describe.configure({ mode: "serial" });

test("auth e2e: magic-link sign-in lands on /account and sign-out returns home", async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== "chromium", "Virtual authenticator support requires Chromium.");

  await performSignIn(page);

  await page.waitForURL((url) => url.pathname === "/account");

  await expect(page.getByRole("heading", { name: "operator@atlas.test" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Passkeys" })).toBeVisible();
  await expect(page.getByText("Workspace setup is waiting")).toBeVisible();

  await Promise.all([
    page.waitForURL((url) => url.pathname === "/"),
    page.getByRole("button", { name: "Sign out" }).first().click(),
  ]);
});
