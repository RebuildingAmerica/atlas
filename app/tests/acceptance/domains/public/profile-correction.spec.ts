import { expect, test } from "@playwright/test";

test("a visitor can report a profile error and keep a follow-up reference", async ({ page }) => {
  await page.goto("/profiles/people/maya-thompson", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Report stale or incorrect information" }).click();
  await expect(page.getByRole("heading", { name: "Review Maya Thompson" })).toBeVisible();

  await page
    .getByRole("textbox", { name: "What should be reviewed?" })
    .fill("The public description needs a current source.");
  await page.getByRole("textbox", { name: "Contact email, optional" }).fill("visitor@atlas.test");
  await page.getByRole("button", { name: "Submit for review" }).click();

  const receipt = page.getByRole("status");
  await expect(receipt).toContainText("Received for review.");
  await expect(receipt).toContainText(/Reference: [0-9a-f-]{36}/);
  await expect(page.getByRole("link", { name: "Email Atlas about this report" })).toHaveAttribute(
    "href",
    /^mailto:hello@rebuildingus\.org\?subject=Atlas%20report%20[0-9a-f-]{36}$/,
  );

  await page.getByRole("link", { name: "Close record review" }).click();
  await expect(page.getByRole("heading", { name: "Maya Thompson" })).toBeVisible();
  await expect(page.getByText("The public description needs a current source.")).toHaveCount(0);
});
