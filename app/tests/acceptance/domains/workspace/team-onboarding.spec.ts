import { expect, test } from "@playwright/test";
import { performSignIn } from "../../helpers/auth";

test.describe("atlas team onboarding UI", () => {
  test("individual workspace upgrades to a team in place, then gates invites behind a subscription", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Passkey virtual authenticator requires Chromium.");

    await performSignIn(page);
    await page.goto("/organization", { waitUntil: "networkidle" });

    // Create an individual (solo) workspace.
    await page.getByText("Individual workspace", { exact: false }).first().click();
    await page.getByLabel("Workspace name").fill("Verify Solo");
    await page.getByLabel("Workspace slug").fill("verify-solo");
    const createButton = page.getByRole("button", { name: "Create workspace" });
    await expect(createButton).toBeEnabled({ timeout: 15_000 });
    await createButton.click();
    await expect(page.getByText("Workspace created.")).toBeVisible({ timeout: 15_000 });
    await page.goto("/organization", { waitUntil: "networkidle" });

    // Task 6: the solo owner sees (and can use) the upgrade-to-team affordance.
    await expect(page.getByRole("heading", { name: "Upgrade to a team" })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /Upgrade to a team workspace/i }).click();
    // Upgrading routes the owner into the subscribe flow.
    await page.waitForURL(/\/pricing/, { timeout: 15_000 });

    // The workspace is now a (free) team: invites are gated behind a
    // subscription (upsell), and no fabricated recurring charge is shown.
    await page.goto("/organization", { waitUntil: "networkidle" });
    await expect(
      page.getByText("Subscribe to Atlas Team to invite members to this workspace."),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Seats & cost" })).toHaveCount(0);
    await page.screenshot({ path: "test-results/org-upgraded-team.png", fullPage: true });
  });
});
