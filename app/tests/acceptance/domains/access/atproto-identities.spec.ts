import { expect, test, type Page } from "@playwright/test";
import { performSignIn } from "../../helpers/auth";

test.describe("Account ATProto identities", () => {
  test("creates and displays an Atlas-managed identity", async ({ page }) => {
    const handle = "managed-account.atlas.test";
    await performSignIn(page);
    await page.goto("/account#identity");

    await page.getByRole("textbox", { name: "New Atlas handle" }).fill(handle);
    await page.getByRole("button", { name: "Create Atlas identity" }).click();

    await expect(page.getByText(handle, { exact: true })).toBeVisible();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  });

  for (const handle of ["account.bsky.social", "account.example"]) {
    test(`connects and displays ${handle} without changing workspaces`, async ({ page }) => {
      await performSignIn(page);
      await page.goto("/account#identity");
      const workspaceBefore = await activeWorkspace(page);

      await expect(page.getByRole("heading", { name: "Use an Atlas identity" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Create Atlas identity" })).toBeDisabled();
      await page.getByText("Connect an existing identity").click();
      await page.getByRole("textbox", { name: "Existing ATProto handle" }).fill(handle);
      await page.getByRole("button", { name: "Connect existing identity" }).click();

      await expect(page.getByText("ATProto account connected.")).toBeVisible();
      await expect(page.getByText(handle, { exact: true })).toBeVisible();
      await expect(page.getByText("Connected", { exact: true })).toBeVisible();
      expect(await activeWorkspace(page)).toBe(workspaceBefore);
    });
  }

  test("checks, disconnects, and reconnects an account identity", async ({ page }) => {
    await performSignIn(page);
    await connectFromAccount(page, "lifecycle.bsky.social");

    await page.getByRole("button", { name: "Check connection" }).click();
    await page.getByRole("button", { name: "Disconnect" }).click();
    await page.getByRole("button", { name: "Disconnect" }).last().click();
    await expect(page.getByText("No ATProto accounts connected.")).toBeVisible();

    await connectFromAccount(page, "lifecycle.bsky.social");
    await expect(page.getByText("lifecycle.bsky.social", { exact: true })).toBeVisible();
  });
});

async function connectFromAccount(page: Page, handle: string): Promise<void> {
  await page.goto("/account#identity");
  await page.getByText("Connect an existing identity").click();
  await page.getByRole("textbox", { name: "Existing ATProto handle" }).fill(handle);
  await page.getByRole("button", { name: "Connect existing identity" }).click();
  await expect(page.getByText("ATProto account connected.")).toBeVisible();
}

async function activeWorkspace(page: Page): Promise<string | null> {
  return page.evaluate(() => window.localStorage.getItem("atlas.activeWorkspaceId"));
}
