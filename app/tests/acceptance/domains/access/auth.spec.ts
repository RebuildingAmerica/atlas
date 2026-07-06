import { expect, test } from "@playwright/test";
import { performSignIn } from "../../helpers/auth";

test.describe.configure({ mode: "serial" });

test("auth e2e: magic-link sign-in lands on /account and sign-out returns home", async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== "chromium", "Virtual authenticator support requires Chromium.");

  const account = await performSignIn(page);

  await page.waitForURL((url) => url.pathname === "/account");

  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.locator("#profile").getByText(account.email)).toBeVisible();
  await expect(page.getByText("Passkeys", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Workspace context" })).toBeVisible();

  const workspaceContext = page.getByRole("heading", { name: "Workspace context" }).locator("..");
  await expect(workspaceContext.getByText("Not set", { exact: true })).toBeVisible();
  await expect(workspaceContext.getByRole("link", { name: "Open" })).toBeVisible();

  await page.getByRole("button", { name: "Profile menu" }).click();
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/"),
    page.getByRole("button", { name: "Sign out" }).click(),
  ]);
});
