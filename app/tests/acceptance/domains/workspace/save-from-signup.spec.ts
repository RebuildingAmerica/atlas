import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { extractFirstUrlFromEmail } from "../../helpers/email";
import { installVirtualAuthenticator, pollLatestMessage } from "../../helpers/auth";

test("a new organizer can finish saving the profile that led them to sign up", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Virtual passkey setup requires Chromium.");
  await installVirtualAuthenticator(page);

  await page.goto("/profiles/people/maya-thompson", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Save", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/sign-in");
  expect(new URL(page.url()).searchParams.get("redirect")).toBe(
    "/profiles/people/maya-thompson?action=save",
  );

  await page.getByRole("link", { name: /Create a free account/ }).click();
  await page.waitForURL((url) => url.pathname === "/sign-up");
  await expect(page.getByRole("heading", { name: "Join Atlas" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("redirect")).toBe(
    "/profiles/people/maya-thompson?action=save",
  );

  const email = `organizer+${randomUUID()}@atlas.test`;
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  const magicLink = extractFirstUrlFromEmail(await pollLatestMessage(email));
  await page.goto(magicLink);

  await page.waitForURL((url) => url.pathname === "/setup");
  expect(new URL(page.url()).searchParams.get("redirect")).toBe(
    "/profiles/people/maya-thompson?action=save",
  );
  await page.getByRole("button", { name: "Add a passkey" }).click();

  await page.waitForURL(
    (url) =>
      url.pathname === "/profiles/people/maya-thompson" &&
      url.searchParams.get("action") === "save",
  );
  await expect(page.getByRole("dialog", { name: "Save to list" })).toBeVisible();
  await page.getByRole("button", { name: "Create a new list" }).click();
  await page.getByLabel("List name").fill("My local research");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("button", { name: /My local research/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.goto("/lists");
  await page.getByRole("link", { name: /My local research/ }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/lists/"));
  await expect(page.getByRole("heading", { name: "My local research" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Maya Thompson" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "Maya Thompson" })).toBeVisible();
  await expect(page.getByText("Your saved list stays available on Free.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add note for Maya Thompson" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download CSV" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Create a brief from this list" })).toHaveCount(0);

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy evidence pack" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Maya Thompson");

  await page.getByRole("link", { name: "Maya Thompson" }).click();
  const sources = page.getByRole("region", { name: "Sources for this profile" });
  await expect(sources.locator('a[href^="http"]').first()).toBeVisible();
});
