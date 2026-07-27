// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PolicyPage } from "@/platform/pages/policy-page";

describe("PolicyPage", () => {
  it("renders the policy title, summary, and revision date", () => {
    render(
      <PolicyPage
        title="Privacy Policy"
        summary="What Atlas collects and why."
        lastUpdated="April 23, 2026"
        sections={[]}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeInTheDocument();
    expect(screen.getByText("What Atlas collects and why.")).toBeInTheDocument();
    expect(screen.getByText("Last updated:").parentElement).toHaveTextContent(
      "Last updated: April 23, 2026",
    );
  });

  it("renders every paragraph of a section under its own heading", () => {
    render(
      <PolicyPage
        title="Terms"
        summary="How Atlas may be used."
        lastUpdated="April 23, 2026"
        sections={[
          {
            title: "About Atlas",
            paragraphs: ["Atlas is a public directory.", "It is operated by a nonprofit."],
          },
          {
            title: "Contact",
            paragraphs: ["Write to hello@rebuildingus.org."],
          },
        ]}
      />,
    );

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual(["About Atlas", "Contact"]);
    expect(screen.getByText("Atlas is a public directory.")).toBeInTheDocument();
    expect(screen.getByText("It is operated by a nonprofit.")).toBeInTheDocument();
    expect(screen.getByText("Write to hello@rebuildingus.org.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("lists a section's bullets, and shows no list when a section has none", () => {
    render(
      <PolicyPage
        title="Security"
        summary="How Atlas is protected."
        lastUpdated="April 23, 2026"
        sections={[
          {
            title: "Safeguards",
            paragraphs: ["We keep accounts protected."],
            bullets: ["Encrypted transport", "Least-privilege access"],
          },
          {
            title: "Nothing listed",
            paragraphs: ["No bullets belong here."],
            bullets: [],
          },
        ]}
      />,
    );

    const lists = screen.getAllByRole("list");
    expect(lists).toHaveLength(1);
    const [bulletList] = lists;
    if (!bulletList) throw new Error("Expected the policy page to render one bullet list.");
    expect(
      within(bulletList)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Encrypted transport", "Least-privilege access"]);
    expect(screen.getByText("No bullets belong here.")).toBeInTheDocument();
  });
});
