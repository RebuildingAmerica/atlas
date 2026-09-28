import { randomUUID } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, test } from "@playwright/test";
import { extractFirstUrlFromEmail } from "../../helpers/email";
import { installVirtualAuthenticator, performSignIn, pollLatestMessage } from "../../helpers/auth";

interface MemberWorkspaceRow {
  organizationId: string;
}

/** Give only this isolated browser-test workspace Team access; no Stripe sale is implied. */
function grantLocalTeamAccess(ownerEmail: string): void {
  const runId = process.env.ATLAS_E2E_RUN_ID?.trim();
  if (!runId) throw new Error("ATLAS_E2E_RUN_ID is required for the isolated auth database.");
  const dbPath = path.join(
    process.cwd(),
    "node_modules",
    ".cache",
    "e2e",
    `atlas-auth-${runId}.sqlite`,
  );
  const db = new Database(dbPath);
  try {
    const member = db
      .prepare(
        `SELECT member.organizationId
         FROM member JOIN user ON user.id = member.userId
         WHERE lower(user.email) = ?`,
      )
      .get(ownerEmail.toLowerCase()) as MemberWorkspaceRow | undefined;
    if (!member) throw new Error("Owner workspace was not created before Team access was granted.");
    db.prepare(
      `INSERT INTO workspace_products (id, workspace_id, product, status, expires_at)
       VALUES (?, ?, 'atlas_team', 'active', NULL)
       ON CONFLICT (workspace_id, product) DO UPDATE
       SET status = 'active', expires_at = NULL`,
    ).run(`e2e_${member.organizationId}_atlas_team`, member.organizationId);
  } finally {
    db.close();
  }
}

test("an admin invites a colleague who accepts and edits the same saved list", async ({
  page,
  browser,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Virtual passkey setup requires Chromium.");
  test.setTimeout(150_000);

  const owner = await performSignIn(page, { createWorkspace: true });
  await page.goto("/lists", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByPlaceholder("List name").fill("Transit research leads");
  await page.getByRole("button", { name: "Create list" }).click();

  await page.goto("/profiles/people/maya-thompson", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Save to list" });
  await picker.getByRole("button", { name: /Transit research leads/ }).click();
  await expect(picker.getByRole("button", { name: /Transit research leads/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.goto("/lists", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /Transit research leads/ }).click();
  const listUrl = page.url();
  await expect(page.getByRole("link", { name: "Maya Thompson" })).toBeVisible();

  await page.goto("/organization", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Upgrade to a team workspace/i }).click();
  await page.waitForURL(/\/pricing/);
  grantLocalTeamAccess(owner.email);
  await page.goto(listUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Share with / }).click();
  await expect(page.getByRole("button", { name: "Stop sharing with team" })).toBeVisible();

  const inviteeEmail = `teammate+${randomUUID()}@atlas.test`;
  await page.goto("/organization", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("combobox", { name: "Workspace" }).first().locator("option"),
  ).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Invitations" })).toBeVisible();
  await page.getByPlaceholder("teammate@your-org.example").fill(inviteeEmail);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Invitation sent.")).toBeVisible();

  const invitationUrl = extractFirstUrlFromEmail(await pollLatestMessage(inviteeEmail));
  expect(new URL(invitationUrl).pathname).toMatch(/^\/accept-invitation\//);
  const inviteeContext = await browser.newContext({
    baseURL: process.env.ATLAS_E2E_APP_URL?.trim() || "http://localhost:3100",
  });
  try {
    const inviteePage = await inviteeContext.newPage();
    await installVirtualAuthenticator(inviteePage);
    await inviteePage.goto(invitationUrl, { waitUntil: "networkidle" });
    await inviteePage.waitForURL((url) => url.pathname === "/sign-in");
    await inviteePage.getByLabel("Email").fill(inviteeEmail);
    await inviteePage.getByRole("button", { name: "Continue with email" }).click();
    await expect(
      inviteePage
        .getByRole("status")
        .getByText("A sign-in link is on the way so you can review the invitation."),
    ).toBeVisible();
    const magicLink = extractFirstUrlFromEmail(await pollLatestMessage(inviteeEmail));
    await inviteePage.goto(magicLink);
    await inviteePage.waitForURL(
      (url) => url.pathname === "/setup" || url.pathname.startsWith("/accept-invitation/"),
    );
    if (new URL(inviteePage.url()).pathname === "/setup") {
      await inviteePage.getByRole("button", { name: "Add a passkey" }).click();
    }
    await inviteePage.waitForURL((url) => url.pathname.startsWith("/accept-invitation/"));
    await expect(inviteePage.getByRole("heading", { name: /You've joined/ })).toBeVisible();
    await inviteePage.getByRole("link", { name: "Open your workspace" }).click();
    await inviteePage.goto("/lists", { waitUntil: "networkidle" });
    if (new URL(inviteePage.url()).pathname === "/setup") {
      await inviteePage.getByRole("button", { name: "Add a passkey" }).click();
      await inviteePage.waitForURL((url) => url.pathname !== "/setup");
      await inviteePage.goto("/lists", { waitUntil: "networkidle" });
    }
    await inviteePage.getByRole("link", { name: /Transit research leads/ }).click();
    await expect(inviteePage.getByRole("link", { name: "Maya Thompson" })).toBeVisible();
    await inviteePage.getByRole("button", { name: "Add note for Maya Thompson" }).click();
    await inviteePage
      .getByRole("textbox", { name: "Note for Maya Thompson" })
      .fill("Ask about route access.");
    await inviteePage.getByRole("button", { name: "Save note for Maya Thompson" }).click();
    await expect(inviteePage.getByText("“Ask about route access.”", { exact: true })).toBeVisible();
  } finally {
    await inviteeContext.close();
  }

  await page.goto(listUrl, { waitUntil: "networkidle" });
  await expect(page.getByText("“Ask about route access.”", { exact: true })).toBeVisible();
});
