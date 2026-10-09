import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { performSignIn, pollLatestMessage } from "../../helpers/auth";
import { extractFirstUrlFromEmail } from "../../helpers/email";
import { expectNoAxeViolations } from "../../helpers/accessibility";

async function expectInvitationSpacing(page: Page, minimumActionGap: number) {
  const heading = await page
    .getByRole("heading", { name: "You’re invited to Atlas Pro" })
    .boundingBox();
  const description = await page
    .getByText(/^Unlimited research, notes and shortlists/)
    .boundingBox();
  const payment = await page.getByRole("group", { name: "Choose how to pay" }).boundingBox();
  const action = await page.getByRole("link", { name: "Continue", exact: true }).boundingBox();
  const monthly = await page
    .getByRole("radio", { name: "Monthly", exact: true })
    .locator("..")
    .boundingBox();
  const annual = await page
    .getByRole("radio", { name: "Annual", exact: true })
    .locator("..")
    .boundingBox();
  if (!heading || !description || !payment || !action || !monthly || !annual)
    throw new Error("Invitation content must be visible.");
  expect(description.y - heading.y - heading.height).toBeGreaterThanOrEqual(24);
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    expect(payment.x).toBeGreaterThan(heading.x + heading.width);
    expect(Math.abs(payment.y - heading.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(action.x - payment.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(action.width - payment.width)).toBeLessThanOrEqual(1);
  } else {
    const gap = payment.y - description.y - description.height;
    expect(gap).toBeGreaterThanOrEqual(32);
    expect(gap).toBeLessThanOrEqual(33);
    const details = page
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: "What’s included" }) });
    await expect(details).not.toHaveAttribute("open", "");
    await expect(
      details.getByText("Unlimited research requests on people and organizations"),
    ).toBeHidden();
    if (page.viewportSize()?.width === 390) {
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
        1000,
      );
    }
  }
  expect(monthly.height).toBeGreaterThanOrEqual(80);
  expect(annual.y - monthly.y - monthly.height).toBeGreaterThanOrEqual(12);
  await expect(page.getByRole("region", { name: "Payment summary" })).toBeAttached();
  await expect(page.getByRole("combobox")).toHaveCount(0);

  expect(action.y - payment.y - payment.height).toBeGreaterThanOrEqual(minimumActionGap);
  const bottomSpace = await page.evaluate(() => ({
    height: Math.max(window.innerHeight, document.documentElement.scrollHeight),
    scroll: window.scrollY,
  }));
  expect(bottomSpace.height - bottomSpace.scroll - action.y - action.height).toBeGreaterThanOrEqual(
    31,
  );
  expect(bottomSpace.height - bottomSpace.scroll - action.y - action.height).toBeLessThanOrEqual(
    33,
  );
  await expect(page.getByRole("link", { name: "Privacy policy" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Terms of service" })).toHaveCount(0);
}

test.describe.configure({ mode: "serial" });
test("public signup, email confirmation, staff invitation and paid onboarding", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
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
  await expect(page.getByRole("heading", { name: "You’re invited to Atlas Pro" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create account", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Annual", exact: true }).click();
  const signupHref = await page
    .getByRole("link", { name: "Create account", exact: true })
    .getAttribute("href");
  if (!signupHref) throw new Error("The invitation must offer account creation.");
  expect(new URL(signupHref, page.url()).searchParams.get("redirect")).toBe(
    "/onboarding?product=atlas_pro&interval=yearly",
  );
  await page.screenshot({
    path: "test-results/waitlist-invited-anonymous-mobile.png",
    fullPage: true,
  });
  await performSignIn(page, { email, createWorkspace: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(invitationUrl);
  await expect(page.getByRole("group", { name: "Choose how to pay" })).toBeVisible();
  const monthlyCard = page.getByRole("radio", { name: "Monthly", exact: true }).locator("..");
  const annualRadio = page.getByRole("radio", { name: "Annual", exact: true });
  const annualCard = annualRadio.locator("..");
  const selectedBackground = await monthlyCard.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await monthlyCard.hover();
  await expect
    .poll(() => monthlyCard.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(selectedBackground);
  const restingBorder = await annualCard.evaluate(
    (element) => getComputedStyle(element).borderColor,
  );
  await annualCard.hover();
  await expect
    .poll(() => annualCard.evaluate((element) => getComputedStyle(element).borderColor))
    .not.toBe(restingBorder);
  await page.getByRole("heading", { name: "You’re invited to Atlas Pro" }).hover();
  await page.getByRole("radio", { name: "Monthly", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: "Annual", exact: true })).toBeChecked();
  await expect(page.getByRole("region", { name: "Payment summary" })).toContainText("$48 per year");
  await expect
    .poll(() => annualCard.evaluate((element) => getComputedStyle(element).outlineWidth))
    .toBe("2px");
  expect(await annualRadio.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
    "none",
  );
  await page.emulateMedia({ forcedColors: "active" });
  expect(await annualCard.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
    "solid",
  );
  expect(await annualCard.evaluate((element) => getComputedStyle(element).outlineColor)).not.toBe(
    "rgba(0, 0, 0, 0)",
  );
  await page.screenshot({
    path: "test-results/waitlist-invited-high-contrast-focus.png",
    fullPage: true,
  });
  await page.emulateMedia({ forcedColors: "none" });
  await page.keyboard.press("Tab");
  await expect(page.getByText("Student pricing", { exact: true })).toBeFocused();
  expect(
    await page
      .getByText("Student pricing", { exact: true })
      .evaluate((element) => getComputedStyle(element).boxShadow),
  ).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("radio", { name: "Student", exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("radio", { name: "Student", exact: true })).toBeHidden();
  await annualRadio.focus();
  await expectNoAxeViolations(page, "invited request");
  await expectInvitationSpacing(page, 80);
  await page.screenshot({ path: "test-results/waitlist-invited.png", fullPage: true });
  await page.setViewportSize({ width: 768, height: 1024 });
  await expectInvitationSpacing(page, 120);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  await page.screenshot({ path: "test-results/waitlist-invited-tablet.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
    .toBe(false);

  await expectInvitationSpacing(page, 120);
  await expectNoAxeViolations(page, "mobile invitation");
  await expect(page.getByRole("navigation", { name: "Signup progress" })).toHaveCount(0);
  await expect(page.getByText(email, { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/waitlist-invited-mobile.png", fullPage: true });
  await page.screenshot({ path: "test-results/waitlist-invited-mobile-screen.png" });
  await expect(page.getByRole("button", { name: "Manage invitation" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Browse Atlas", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("link", { name: "Continue", exact: true }).scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await expectInvitationSpacing(page, 32);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  await page.screenshot({ path: "test-results/waitlist-invited-short-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "You’re invited to Atlas Pro" }).scrollIntoViewIfNeeded();
  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    storageState: await page.context().storageState(),
  });
  const touchPage = await touchContext.newPage();
  await touchPage.goto(invitationUrl);
  expect(await touchPage.evaluate(() => window.innerWidth)).toBe(390);
  expect(await touchPage.evaluate(() => window.matchMedia("(hover: none)").matches)).toBe(true);
  const touchAnnual = touchPage.getByRole("radio", { name: "Annual", exact: true });
  await touchAnnual.locator("..").tap({ position: { x: 12, y: 60 } });
  await expect(touchAnnual).toBeChecked();
  expect(await touchAnnual.evaluate((element) => element.matches(":focus-visible"))).toBe(false);
  expect(
    await touchAnnual.locator("..").evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe("none");
  for (const control of [
    touchPage.getByRole("link", { name: "Atlas", exact: true }),
    touchPage.getByRole("link", { name: "Pricing", exact: true }),
    touchPage.getByText("Student pricing", { exact: true }),
    touchPage.locator("summary", { hasText: "What’s included" }),
  ]) {
    const target = await control.boundingBox();
    if (!target) throw new Error("A touch control must be visible.");
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.width).toBeGreaterThanOrEqual(44);
  }
  const planDetails = touchPage
    .locator("details")
    .filter({ has: touchPage.locator("summary", { hasText: "What’s included" }) });
  const summary = planDetails.locator("summary");
  const row = await summary.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      border: style.borderTopStyle,
      width: style.borderTopWidth,
      decoration: style.textDecorationLine,
      chevron: getComputedStyle(element, "::after").rotate,
    };
  });
  expect(row.border).toBe("solid");
  expect(row.width).toBe("1px");
  expect(row.decoration).toBe("none");
  expect(row.chevron).toBe("45deg");
  await summary.tap();
  expect(await summary.evaluate((element) => getComputedStyle(element, "::after").rotate)).toBe(
    "225deg",
  );
  await expect(planDetails.getByText(/API access with 1,000 requests per day/)).toBeVisible();
  await planDetails.locator("summary").tap();
  await expectNoAxeViolations(touchPage, "touch invitation");
  await touchPage.screenshot({
    path: "test-results/waitlist-invited-touch-mobile.png",
    fullPage: true,
  });
  await touchPage.getByText("Student pricing", { exact: true }).tap();
  await touchPage.getByRole("radio", { name: "Student", exact: true }).locator("..").tap();
  await expect(touchPage.getByRole("region", { name: "Payment summary" })).toContainText(
    "$12.80 every four months",
  );
  await touchPage.setViewportSize({ width: 320, height: 568 });
  expect(
    await touchPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
  ).toBe(false);
  await expectNoAxeViolations(touchPage, "narrow touch student invitation");
  await touchPage.screenshot({
    path: "test-results/waitlist-invited-touch-student.png",
    fullPage: true,
  });
  await touchContext.close();
  await page.getByRole("link", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Choose workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Use / })).toBeEnabled();
  await expectNoAxeViolations(page, "mobile workspace step");
  await page.screenshot({ path: "test-results/waitlist-workspace-mobile-screen.png" });
  await page.getByRole("button", { name: /^Use / }).click();
  await expect(page.getByRole("heading", { name: "Continue to payment" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Payment summary" })).toContainText("$48 per year");
  await expect(page.getByRole("region", { name: "Payment summary" })).toContainText(
    "Renews annually",
  );
  await expectNoAxeViolations(page, "mobile payment step");
  await page.screenshot({ path: "test-results/waitlist-payment-mobile-screen.png" });
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
  await expect(page.getByText(longEmail, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  await expectNoAxeViolations(page, "long email address");
  await page.screenshot({ path: "test-results/waitlist-long-email.png", fullPage: true });
  await page.getByRole("button", { name: "Confirm email" }).click();
  await expect(page.getByRole("heading", { name: "You’re on the waitlist" })).toBeVisible();
  await expect(page.getByText(longEmail, { exact: true })).toHaveCount(0);
  await expectNoAxeViolations(page, "mobile confirmed request");
  await page.goto("/waitlist/link?kind=invite&token=expired");
  await expect(page.getByRole("heading", { name: "This link no longer works" })).toBeVisible();
  await page.getByRole("link", { name: "Atlas", exact: true }).click();
  await page.getByRole("button", { name: "More navigation", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Public navigation menu" })
    .getByRole("link", { name: "Explore", exact: true })
    .click();
  await expect(page).toHaveURL(/\/browse$/);
});
