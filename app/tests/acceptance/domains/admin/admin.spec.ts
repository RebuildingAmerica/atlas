import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { performSignIn, requireEnv } from "../../helpers/auth";

test.describe("admin journey", () => {
  test("should be able to access administrative pages", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Virtual authenticator support requires Chromium.");

    await performSignIn(page, { createWorkspace: true, email: "person@atlas.test" });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Service health" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Review profile verifications" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Review discounts" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Inspect cloud costs" })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(page.getByText("Service health")).toBeVisible();

    await page.goto("/admin/discounts");
    await expect(
      page
        .getByText(/Discount verifications|Loading|Discount verifications could not load/)
        .first(),
    ).toBeVisible();

    await page.goto("/oauth/consent?client_id=e2e-unknown-client");
    await expect(page.getByRole("heading", { name: /Allow access to Atlas/ })).toBeVisible();

    // The pages are synthetic, but the editor, private queue, approval, and
    // public profile all use the real local API and browser session.
    const candidateName = `Atlas E2E Transit ${randomUUID().slice(0, 8)}`;
    const sourceNote = "The test page describes local transit advocacy in Las Vegas, Nevada.";
    const publicQueryUrl = new URL("/api/entities", requireEnv("ATLAS_E2E_API_URL"));
    publicQueryUrl.searchParams.set("query", candidateName);

    await page.goto("/admin/discovery-reviews");
    await page.getByRole("button", { name: "Add organization from official source" }).click();
    await page.getByRole("textbox", { name: "Organization name" }).fill(candidateName);
    await page.getByRole("textbox", { name: "City" }).fill("Las Vegas");
    await page
      .getByRole("textbox", { name: "What the organization does" })
      .fill("Synthetic Las Vegas group used to verify editorial publication.");
    await page
      .getByRole("textbox", { name: "Official page supporting this work" })
      .fill("https://example.org/about");
    await page.getByRole("textbox", { name: "What the page supports" }).fill(sourceNote);
    await page
      .getByRole("textbox", { name: "Official next step" })
      .fill("https://example.org/join");
    await page.getByRole("combobox", { name: "Issue area" }).selectOption("public_transit");
    await page.getByRole("button", { name: "Add issue area" }).click();
    await page.getByRole("checkbox", { name: /I checked both official pages/ }).check();
    await page.getByRole("button", { name: "Add to review queue" }).click();

    await expect(
      page.getByText("Organization ready for editorial review. Its profile is not public."),
    ).toBeVisible();
    const beforeApproval = await page.request.get(publicQueryUrl.toString());
    expect(beforeApproval.ok()).toBe(true);
    const heldResults = (await beforeApproval.json()) as { total: number };
    expect(heldResults.total).toBe(0);

    const review = page.locator("article").filter({ hasText: candidateName });
    await expect(review).toBeVisible();
    await expect(review.getByText(sourceNote)).toBeVisible();
    await review.getByRole("checkbox", { name: /I checked these sources/ }).check();
    await review.getByRole("button", { name: `Approve ${candidateName}` }).click();
    await expect(review).toHaveCount(0);

    const afterApproval = await page.request.get(publicQueryUrl.toString());
    expect(afterApproval.ok()).toBe(true);
    const results = (await afterApproval.json()) as {
      items: { id: string; name: string; slug: string }[];
      total: number;
    };
    expect(results.items).toContainEqual(expect.objectContaining({ name: candidateName }));
    const published = results.items.find((item) => item.name === candidateName);
    expect(published?.slug).toBeTruthy();
    await page.goto(`/profiles/organizations/${published?.slug}`);
    await expect(page.getByRole("heading", { name: candidateName })).toBeVisible();

    const correctedDescription =
      "Synthetic Las Vegas group with a reviewed correction for transit research.";
    await page.goto("/admin/discovery-reviews");
    await page.getByRole("button", { name: "Improve existing organization" }).click();
    await page.getByRole("textbox", { name: "Find published organization" }).fill(candidateName);
    await page.getByRole("button", { name: "Find organization" }).click();
    await page.getByRole("button", { name: `Select ${candidateName} · Las Vegas, NV` }).click();
    await expect(
      page.getByRole("heading", { name: "Improve existing organization" }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "What the organization does" })
      .fill(correctedDescription);
    await page
      .getByRole("textbox", { name: "What the page supports" })
      .fill("The test page supports the updated transit research description.");
    await page
      .getByRole("combobox", { name: "Issue area" })
      .selectOption("transportation_and_mobility");
    await page.getByRole("button", { name: "Add issue area" }).click();
    await page.getByRole("button", { name: "Remove Public transit" }).click();
    await page.getByRole("checkbox", { name: /I checked both official pages/ }).check();
    await page.getByRole("button", { name: "Propose correction" }).click();
    await expect(page.getByText(/Correction ready for editorial review/)).toBeVisible();

    const publicDetailUrl = new URL(
      `/api/entities/${published?.id}`,
      requireEnv("ATLAS_E2E_API_URL"),
    );
    const beforeCorrection = await page.request.get(publicDetailUrl.toString());
    expect(beforeCorrection.ok()).toBe(true);
    expect((await beforeCorrection.json()) as { description: string }).toHaveProperty(
      "description",
      "Synthetic Las Vegas group used to verify editorial publication.",
    );
    const correctionReview = page.locator("article").filter({ hasText: candidateName });
    await expect(correctionReview).toBeVisible();
    await correctionReview.getByRole("checkbox", { name: /I checked these sources/ }).check();
    await correctionReview.getByRole("button", { name: `Approve ${candidateName}` }).click();
    await expect(correctionReview).toHaveCount(0);

    const afterCorrection = await page.request.get(publicDetailUrl.toString());
    expect(afterCorrection.ok()).toBe(true);
    const corrected = (await afterCorrection.json()) as {
      description: string;
      issue_area_ids: string[];
    };
    expect(corrected.description).toBe(correctedDescription);
    expect(corrected.issue_area_ids).toEqual(["transportation_and_mobility"]);
  });
});
