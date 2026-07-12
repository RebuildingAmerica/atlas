import { expect, test } from "@playwright/test";
import { performSignIn } from "../../helpers/auth";

test.describe("atlas team onboarding UI", () => {
  test("personal workspace upgrades to a team in place, then gates invites behind a subscription", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Passkey virtual authenticator requires Chromium.");

    await performSignIn(page);
    await page.goto("/organization", { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "My Workspace" })).toBeVisible();
    await expect(page.getByText("This is a personal workspace.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upgrade to a team" })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /Upgrade to a team workspace/i }).click();
    await page.waitForURL(/\/pricing/, { timeout: 15_000 });

    await page.goto("/organization", { waitUntil: "networkidle" });
    await expect(
      page.getByText("Subscribe to Atlas Team to invite members to this workspace."),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Seats & cost" })).toHaveCount(0);
    await page.screenshot({ path: "test-results/org-upgraded-team.png", fullPage: true });
  });
});
