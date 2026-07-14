import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { installVirtualAuthenticator, pollLatestMessage } from "../../helpers/auth";
import { extractFirstUrlFromEmail } from "../../helpers/email";

test.describe.configure({ mode: "serial" });

const startedAt = Date.now();
const timestampsPath = process.env.ATLAS_E2E_STEP_TIMESTAMPS_PATH?.trim();
const captionsEnabled = process.env.ATLAS_E2E_CHAPTER_CAPTIONS === "1";
const captionDwellMs = Number.parseInt(process.env.ATLAS_E2E_CHAPTER_DWELL_MS || "1200", 10);
if (!Number.isInteger(captionDwellMs) || captionDwellMs < 0) {
  throw new Error("ATLAS_E2E_CHAPTER_DWELL_MS must be a non-negative integer.");
}
const actionDwellMs = Number.parseInt(process.env.ATLAS_E2E_ACTION_DWELL_MS || "0", 10);
if (!Number.isInteger(actionDwellMs) || actionDwellMs < 0) {
  throw new Error("ATLAS_E2E_ACTION_DWELL_MS must be a non-negative integer.");
}
const typeDelayMs = Number.parseInt(process.env.ATLAS_E2E_TYPE_DELAY_MS || "0", 10);
if (!Number.isInteger(typeDelayMs) || typeDelayMs < 0) {
  throw new Error("ATLAS_E2E_TYPE_DELAY_MS must be a non-negative integer.");
}

type PaidPlan = "pro" | "team" | "research-pass";

interface PaidPlanConfig {
  ctaName: RegExp;
  emailPrefix: string;
  finalHeading: RegExp;
  productLabel: string;
  visibleLabel: string;
}

const paidPlans: Record<PaidPlan, PaidPlanConfig> = {
  pro: {
    ctaName: /Get Atlas Pro/i,
    emailPrefix: "pro",
    finalHeading: /Thanks for backing Atlas/i,
    productLabel: "Atlas Pro",
    visibleLabel: "Atlas Pro",
  },
  team: {
    ctaName: /Get Atlas Team/i,
    emailPrefix: "team",
    finalHeading: /Your team workspace is ready/i,
    productLabel: "Atlas Team",
    visibleLabel: "Atlas Team",
  },
  "research-pass": {
    ctaName: /Get 30-day pass/i,
    emailPrefix: "research-pass",
    finalHeading: /Thanks for backing Atlas/i,
    productLabel: "Atlas Research Pass",
    visibleLabel: "Research Pass",
  },
};

function accountEmail(prefix: string): string {
  return `person+oobe-${prefix}-${randomUUID()}@atlas.test`;
}

function stamp(label: string): void {
  if (!timestampsPath) {
    return;
  }
  mkdirSync(path.dirname(timestampsPath), { recursive: true });
  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
  appendFileSync(timestampsPath, `${String(elapsedSeconds).padStart(4, "0")}s ${label}\n`);
}

async function caption(page: Page, label: string): Promise<void> {
  stamp(label);
  if (!captionsEnabled) {
    return;
  }
  await page.evaluate((text) => {
    const existing = document.querySelector<HTMLElement>("[data-atlas-e2e-caption]");
    const captionElement = existing ?? document.createElement("div");
    captionElement.setAttribute("data-atlas-e2e-caption", "");
    captionElement.textContent = text;
    Object.assign(captionElement.style, {
      background: "rgba(25, 22, 18, 0.92)",
      border: "1px solid rgba(255, 255, 255, 0.24)",
      borderRadius: "12px",
      boxShadow: "0 16px 40px rgba(0, 0, 0, 0.24)",
      color: "#fffaf0",
      font: "600 18px/1.3 system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      left: "24px",
      maxWidth: "calc(100vw - 48px)",
      padding: "12px 16px",
      pointerEvents: "none",
      position: "fixed",
      top: "24px",
      zIndex: "2147483647",
    });
    if (!existing) {
      document.body.appendChild(captionElement);
    }
  }, label);
  await page.waitForTimeout(captionDwellMs);
}

async function chapter<T>(page: Page, label: string, callback: () => Promise<T>): Promise<T> {
  return await test.step(label, async () => {
    await caption(page, label);
    return await callback();
  });
}

async function pauseAfterAction(page: Page): Promise<void> {
  if (actionDwellMs > 0) {
    await page.waitForTimeout(actionDwellMs);
  }
}

async function pauseBeforeAction(page: Page): Promise<void> {
  if (actionDwellMs > 0) {
    await page.waitForTimeout(Math.min(350, actionDwellMs));
  }
}

async function clickAction(locator: Locator, options: { force?: boolean } = {}): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await pauseBeforeAction(locator.page());
  await locator.click(options);
  await pauseAfterAction(locator.page());
}

async function fillAction(locator: Locator, value: string): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await pauseBeforeAction(locator.page());
  if (typeDelayMs > 0) {
    await locator.fill("");
    await locator.pressSequentially(value, { delay: typeDelayMs });
  } else {
    await locator.fill(value);
  }
  await pauseAfterAction(locator.page());
}

async function goHome(page: Page, label: string): Promise<void> {
  await chapter(page, `${label}: homepage`, async () => {
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: /Find the people rebuilding America/i }),
    ).toBeVisible();
  });
}

async function signOutIfNeeded(page: Page): Promise<boolean> {
  const profileMenu = page.getByRole("button", { name: "Profile menu" });
  if ((await profileMenu.count()) === 0) {
    return false;
  }

  await profileMenu.click();
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 }),
    page.getByRole("button", { name: "Sign out" }).click(),
  ]);
  await page.waitForLoadState("networkidle");
  return true;
}

async function resetSession(page: Page, label: string): Promise<void> {
  await chapter(page, `${label}: reset session`, async () => {
    await page.goto("/account", { waitUntil: "networkidle" });
    await signOutIfNeeded(page);
  });
}

async function openPricingFromHome(page: Page, label: string): Promise<void> {
  await resetSession(page, label);
  await goHome(page, label);

  await chapter(page, `${label}: pricing`, async () => {
    const pricingLink = page.getByRole("link", { name: /Pro and Team plans/i });
    await pricingLink.scrollIntoViewIfNeeded();
    await clickAction(pricingLink);
    await page.waitForURL((url) => url.pathname === "/pricing");
    await expect(page.getByRole("heading", { name: /Atlas is free to use/i })).toBeVisible();
    await pauseAfterAction(page);
  });
}

async function completeSignUp(page: Page, email: string): Promise<void> {
  const emailInput = page.getByLabel("Email");
  await fillAction(emailInput, email);
  await expect(emailInput).toHaveValue(email);

  const createButton = page.getByRole("button", {
    name: /Create account|Continue with team setup/i,
  });
  await expect(createButton).toBeEnabled({ timeout: 15_000 });
  await clickAction(createButton);
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible({
    timeout: 15_000,
  });
  await pauseAfterAction(page);

  const rawEmail = await pollLatestMessage(email);
  await page.goto(extractFirstUrlFromEmail(rawEmail), { waitUntil: "networkidle" });
  await page.waitForURL(
    (url) =>
      ["/account", "/discovery", "/organization", "/setup", "/onboarding"].includes(url.pathname),
    { timeout: 60_000 },
  );
  await pauseAfterAction(page);
}

async function addPasskeyIfNeeded(page: Page, nextText?: string | RegExp): Promise<void> {
  const addPasskey = page.getByRole("button", { name: "Add a passkey" });
  try {
    await addPasskey.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    return;
  }

  await expect(addPasskey).toBeEnabled({ timeout: 20_000 });
  await clickAction(addPasskey);
  if (nextText) {
    await expect(page.getByText(nextText).first()).toBeVisible({ timeout: 60_000 });
  }
  await page.waitForLoadState("networkidle");
  await pauseAfterAction(page);
}

async function completeFreeAccount(page: Page): Promise<void> {
  await goHome(page, "Free");
  await chapter(page, "Free: create account", async () => {
    await clickAction(page.getByRole("link", { name: /Create a free account/i }));
    await page.waitForURL((url) => url.pathname === "/sign-up");
    await pauseAfterAction(page);
    await completeSignUp(page, accountEmail("free"));
  });

  await chapter(page, "Free: add passkey", async () => {
    await page.goto("/setup?redirect=%2Faccount", { waitUntil: "networkidle" });
    await addPasskeyIfNeeded(page, /^Account$/);
  });

  await chapter(page, "Free: workspace ready", async () => {
    await page.goto("/account", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Workspace context" })).toBeVisible();
    await expect(page.locator("#profile").getByText("My Workspace", { exact: true })).toBeVisible();
  });
}

async function startPaidPlan(page: Page, plan: PaidPlan): Promise<void> {
  const config = paidPlans[plan];
  await openPricingFromHome(page, config.visibleLabel);

  await chapter(page, `${config.visibleLabel}: create account`, async () => {
    await clickAction(page.getByRole("button", { name: config.ctaName }));
    await page.waitForURL((url) => url.pathname === "/onboarding");
    await expect(page.getByRole("heading", { name: "Start with your account" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(config.productLabel, { exact: true })).toBeVisible();
    await pauseAfterAction(page);

    await clickAction(page.getByRole("link", { name: "Create account" }));
    await page.waitForURL((url) => url.pathname === "/sign-up");
    await pauseAfterAction(page);
    await completeSignUp(page, accountEmail(config.emailPrefix));
  });

  await chapter(page, `${config.visibleLabel}: add passkey`, async () => {
    await addPasskeyIfNeeded(page, /Choose workspace|Name your team workspace/i);
    await page.waitForURL((url) => url.pathname === "/onboarding", { timeout: 60_000 });
    await expect(
      page.getByRole("heading", { name: /Choose workspace|Name your team workspace/i }),
    ).toBeVisible({ timeout: 30_000 });
  });
}

async function attachWorkspace(page: Page, plan: PaidPlan): Promise<void> {
  await chapter(page, `${paidPlans[plan].visibleLabel}: workspace`, async () => {
    if (plan === "team") {
      const workspaceId = randomUUID().slice(0, 8);
      await expect(page.getByText("Name your team workspace", { exact: false })).toBeVisible({
        timeout: 30_000,
      });
      await fillAction(page.getByLabel("Workspace name"), `OOBE Team ${workspaceId}`);
      await clickAction(page.getByRole("button", { name: "Continue to payment" }));
    } else {
      const useWorkspace = page.getByRole("button", { name: /Use My Workspace/i });
      await expect(useWorkspace).toBeEnabled({ timeout: 30_000 });
      await clickAction(useWorkspace);
    }

    await expect(
      page.getByText("Stripe will handle the payment details", { exact: false }),
    ).toBeVisible({ timeout: 30_000 });
    await pauseAfterAction(page);
  });
}

async function fillTextIfVisible(page: Page, selector: string, value: string): Promise<void> {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0 || !(await locator.isVisible())) {
    return;
  }
  await fillAction(locator, value);
}

async function fillStripeInput(
  page: Page,
  selectors: readonly string[],
  value: string,
  fieldName: string,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const pageInput = page.locator(selector).first();
      if ((await pageInput.count()) > 0 && (await pageInput.isVisible())) {
        await fillAction(pageInput, value);
        return;
      }

      for (const frame of page.frames()) {
        const frameInput = frame.locator(selector).first();
        if ((await frameInput.count()) > 0 && (await frameInput.isVisible())) {
          await fillAction(frameInput, value);
          return;
        }
      }
    }
    await page.waitForTimeout(250);
  }

  throw new Error(`Stripe checkout did not expose the ${fieldName} field.`);
}

async function clickIfVisible(
  locator: Locator,
  options: { force?: boolean } = {},
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible()) {
        await clickAction(candidate, options);
        return true;
      }
    }
    await locator.page().waitForTimeout(200);
  }
  return false;
}

async function selectStripeCard(page: Page): Promise<void> {
  const cardRadio = page.getByRole("radio", { name: "Card" }).first();
  await expect(cardRadio).toBeAttached({ timeout: 30_000 });
  await cardRadio.scrollIntoViewIfNeeded();
  await pauseBeforeAction(page);
  await cardRadio.check({ force: true });
  await expect(cardRadio).toBeChecked({ timeout: 10_000 });
  await pauseAfterAction(page);

  await clickIfVisible(
    page.getByRole("button", { name: /Pay with card/i }),
    { force: true },
    10_000,
  );

  await fillStripeInput(
    page,
    [
      'input[name="cardNumber"]',
      'input[name="number"]',
      'input[autocomplete="cc-number"]',
      'input[placeholder*="1234"]',
    ],
    "4242424242424242",
    "card number",
  );
}

async function completeStripeCheckout(page: Page, plan: PaidPlan): Promise<void> {
  const planLabel = paidPlans[plan].visibleLabel;
  await chapter(page, `${planLabel}: Stripe checkout`, async () => {
    await clickAction(page.getByRole("button", { name: "Continue to Stripe" }));
    await page.waitForURL((url) => url.hostname.endsWith("stripe.com"), { timeout: 90_000 });
    await pauseAfterAction(page);

    await selectStripeCard(page);
    const saveInfo = page.getByRole("checkbox", { name: /Save my information/i });
    if ((await saveInfo.count()) > 0 && (await saveInfo.first().isChecked())) {
      const saveInfoCheckbox = saveInfo.first();
      await saveInfoCheckbox.scrollIntoViewIfNeeded();
      await pauseBeforeAction(page);
      await saveInfoCheckbox.uncheck();
      await pauseAfterAction(page);
    }

    await fillTextIfVisible(page, 'input[name="email"]', accountEmail(`stripe-${plan}`));
    await fillStripeInput(
      page,
      [
        'input[name="cardExpiry"]',
        'input[name="expiry"]',
        'input[autocomplete="cc-exp"]',
        'input[placeholder*="MM"]',
      ],
      "1234",
      "expiration",
    );
    await fillStripeInput(
      page,
      [
        'input[name="cardCvc"]',
        'input[name="cvc"]',
        'input[autocomplete="cc-csc"]',
        'input[placeholder*="CVC"]',
        'input[placeholder*="CVV"]',
      ],
      "123",
      "CVC",
    );
    await fillStripeInput(
      page,
      ['input[name="billingName"]', 'input[autocomplete="cc-name"]'],
      "Atlas OOBE",
      "cardholder name",
    );
    await fillStripeInput(
      page,
      [
        'input[name="billingPostalCode"]',
        'input[name="postal"]',
        'input[autocomplete="postal-code"]',
        'input[placeholder*="ZIP"]',
      ],
      "12345",
      "postal code",
    );

    const submitButton = page.getByRole("button", { name: /Pay|Subscribe/i }).last();
    await expect(submitButton).toBeEnabled({ timeout: 30_000 });
    await clickAction(submitButton);
    await page.waitForURL((url) => url.pathname === "/onboarding/complete", { timeout: 120_000 });
    await expect(page.getByRole("heading", { name: paidPlans[plan].finalHeading })).toBeVisible({
      timeout: 60_000,
    });
    await pauseAfterAction(page);
  });

  await caption(page, `${planLabel}: complete`);
}

async function completePaidPlan(page: Page, plan: PaidPlan): Promise<void> {
  await startPaidPlan(page, plan);
  await attachWorkspace(page, plan);
  await completeStripeCheckout(page, plan);
}

test("homepage OOBE covers every public plan", async ({ browserName, page }) => {
  test.setTimeout(10 * 60_000);
  test.skip(browserName !== "chromium", "Passkey virtual authenticator requires Chromium.");

  await installVirtualAuthenticator(page);
  await caption(page, "OOBE: start");
  await completeFreeAccount(page);
  await completePaidPlan(page, "pro");
  await completePaidPlan(page, "team");
  await completePaidPlan(page, "research-pass");
  await caption(page, "OOBE: end");
});
