import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { performSignIn, pollLatestMessage } from "../../helpers/auth";
import { extractFirstUrlFromEmail } from "../../helpers/email";
import { expectNoAxeViolations } from "../../helpers/accessibility";

test.describe.configure({ mode: "serial" });
test("public signup, email confirmation, staff invitation and paid onboarding", async ({
  page,
  browser,
}) => {
  const email = `maya.${randomUUID().slice(0, 8)}@atlas.test`;
  await page.goto("/browse");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await page.goto("/pricing");
  await page.getByRole("button", { name: "Join waitlist" }).first().click();
  await expect(page).toHaveURL(/\/waitlist\?/);
  await expectNoAxeViolations(page, "waitlist signup");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Join waitlist" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expectNoAxeViolations(page, "waitlist receipt");
  await page.screenshot({ path: "test-results/waitlist-receipt.png", fullPage: true });
  const confirmationUrl = extractFirstUrlFromEmail(await pollLatestMessage(email));
  await page.goto(confirmationUrl);
  await expect(page.getByRole("heading", { name: "Confirm your email" })).toBeVisible();
  await expectNoAxeViolations(page, "email confirmation");
  await page.screenshot({ path: "test-results/waitlist-confirmation.png", fullPage: true });
  await page.getByRole("button", { name: "Confirm email" }).click();
  await expect(page.getByRole("heading", { name: "You’re on the waitlist" })).toBeVisible();
  await expectNoAxeViolations(page, "confirmed request");
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await performSignIn(adminPage, { email: "person@atlas.test", createWorkspace: true });
  await adminPage.goto("/admin/waitlist");
  await expectNoAxeViolations(adminPage, "staff waitlist");
  await adminPage.screenshot({ path: "test-results/waitlist-admin.png", fullPage: true });
  await adminPage.getByLabel("Search requests").fill(email);
  await adminPage.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(adminPage.getByRole("region", { name: "Review invitations" })).toContainText(email);
  await adminPage.getByRole("button", { name: "Send invitations", exact: true }).click();
  await expect(adminPage.getByText(`${email}: Invitation sent.`, { exact: true })).toBeVisible();
  const invitationUrl = extractFirstUrlFromEmail(await pollLatestMessage(email));
  await page.goto(invitationUrl);
  await expect(page.getByRole("heading", { name: "Join Atlas Pro" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Create a free account", exact: true }),
  ).toBeVisible();
  await performSignIn(page, { email, createWorkspace: true });
  await page.goto(invitationUrl);
  await expect(page.getByLabel("Payment option")).toBeVisible();
  await expectNoAxeViolations(page, "invited request");
  await page.screenshot({ path: "test-results/waitlist-invited.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
    .toBe(false);

  await expectNoAxeViolations(page, "mobile invitation");
  await page.screenshot({ path: "test-results/waitlist-invited-mobile.png", fullPage: true });
  await page.screenshot({ path: "test-results/waitlist-invited-mobile-screen.png" });
  await expect(page.getByRole("button", { name: "Manage invitation" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Browse Atlas", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("link", { name: "Continue to checkout" }).click();
  await expect(page.getByRole("heading", { name: "Choose workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Use / })).toBeEnabled();
  await adminPage.goto("/admin/waitlist");
  await adminPage.getByLabel("Status", { exact: true }).selectOption("invited");
  await adminPage.getByLabel("Search requests").fill(email);
  await adminPage.getByRole("button", { name: email, exact: true }).click();
  await expect(adminPage.getByRole("dialog", { name: "Request details" })).toBeVisible();
  await expectNoAxeViolations(adminPage, "staff request details");
  await adminPage.screenshot({ path: "test-results/waitlist-details.png", fullPage: true });
  await adminPage.keyboard.press("Escape");
  await expect(adminPage.getByRole("button", { name: email, exact: true })).toBeFocused();
  await adminPage.getByRole("button", { name: email, exact: true }).click();
  await adminPage.getByRole("button", { name: "Withdraw invitation" }).click();
  await adminPage.getByRole("button", { name: "Confirm withdrawal" }).click();
  await expect(adminPage.getByText("Invitation withdrawn.", { exact: true })).toBeVisible();
  await page.goto(invitationUrl);
  await expect(
    page.getByRole("heading", { name: "This invitation has been withdrawn" }),
  ).toBeVisible();
  await adminContext.close();
});

test("mobile signup and expired-link recovery keep public browsing available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/waitlist?product=atlas_team");
  await expect(page.getByRole("heading", { name: "Join the waitlist" })).toBeVisible();
  await expectNoAxeViolations(page, "mobile signup");
  await expect(page.getByLabel("Plan", { exact: true })).toHaveValue("atlas_team");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({ path: "test-results/waitlist-mobile.png", fullPage: true });
  await page.screenshot({ path: "test-results/waitlist-mobile-screen.png" });
  const longEmail = `community-research.${randomUUID()}@atlas.test`;
  await page.getByLabel("Email", { exact: true }).fill(longEmail);
  await page.getByRole("button", { name: "Join waitlist" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.goto(extractFirstUrlFromEmail(await pollLatestMessage(longEmail)));
  await page.getByRole("button", { name: "Confirm email" }).click();
  await expect(page.getByRole("heading", { name: "You’re on the waitlist" })).toBeVisible();
  await expect(page.getByText(longEmail, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  await expectNoAxeViolations(page, "long email address");
  await page.screenshot({ path: "test-results/waitlist-long-email.png", fullPage: true });
  await page.goto("/waitlist/link?kind=invite&token=expired");
  await expect(page.getByRole("heading", { name: "This link no longer works" })).toBeVisible();
  await page.getByRole("button", { name: "More navigation", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Public navigation menu" })
    .getByRole("link", { name: "Explore", exact: true })
    .click();
  await expect(page).toHaveURL(/\/browse$/);
});
