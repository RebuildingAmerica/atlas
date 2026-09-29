import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * Fails with every WCAG 2.1 A/AA violation axe finds on the current page, one
 * line per rule naming the elements involved.
 */
export async function expectNoAxeViolations(page: Page, surface: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const found = violations.flatMap((violation) =>
    violation.nodes.map(
      (node) =>
        `${violation.id} (${violation.impact ?? "unrated"}): ${node.target.join(" ")} — ${
          node.failureSummary?.replaceAll("\n", " ") ?? "no summary"
        }`,
    ),
  );
  expect(found, `${surface} has WCAG 2.1 AA violations`).toEqual([]);
}
