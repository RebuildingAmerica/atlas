// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import { IssueFootprint } from "@/domains/catalog/components/profiles/issue-footprint";
import { PresenceSection } from "@/domains/catalog/components/profiles/presence-section";
import { ReachSection } from "@/domains/catalog/components/profiles/reach-section";

afterEach(() => {
  cleanup();
});

describe("ActorAvatar", () => {
  it("renders initials for a person without photo", () => {
    render(<ActorAvatar name="Jane Doe" type="person" />);
    expect(screen.getByLabelText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("JD")).toBeInTheDocument();
  });

  it("renders initials for an organization", () => {
    render(<ActorAvatar name="Acme Corp" type="organization" />);
    const el = screen.getByLabelText("Acme Corp");
    expect(el.className).toContain("rounded-xl");
  });

  it("renders an image when photoUrl is provided", () => {
    render(<ActorAvatar name="Jane" type="person" photoUrl="https://img.test/j.png" />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://img.test/j.png");
  });

  it("applies size classes", () => {
    render(<ActorAvatar name="A B" type="person" size="sm" />);
    const el = screen.getByLabelText("A B");
    expect(el.className).toContain("h-8");
  });
});

describe("IssueFootprint", () => {
  it("returns null for empty issue areas", () => {
    const { container } = render(<IssueFootprint issueAreas={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders grouped issue areas with labels", () => {
    render(
      <IssueFootprint
        issueAreas={["housing_affordability"]}
        issueAreaLabels={{ housing_affordability: "Housing Affordability" }}
      />,
    );
    expect(screen.getByText("Housing Affordability")).toBeInTheDocument();
    expect(screen.getByText("Housing & Built Environment")).toBeInTheDocument();
  });

  it("can suppress the repeated section label when the parent section already provides it", () => {
    render(
      <IssueFootprint
        issueAreas={["housing_affordability"]}
        issueAreaLabels={{ housing_affordability: "Housing Affordability" }}
        showLabel={false}
      />,
    );
    expect(screen.queryByText("Issue footprint")).not.toBeInTheDocument();
    expect(screen.getByText("Housing Affordability")).toBeInTheDocument();
  });

  it("falls back to humanized slug when label is missing", () => {
    render(<IssueFootprint issueAreas={["housing_affordability"]} />);
    expect(screen.getByText("Housing Affordability")).toBeInTheDocument();
  });

  it("ignores unknown slugs", () => {
    const { container } = render(<IssueFootprint issueAreas={["unknown_slug"]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("ReachSection", () => {
  it("returns null when no contact info provided", () => {
    const { container } = render(<ReachSection />);
    expect(container.innerHTML).toBe("");
  });

  it("renders email when provided", () => {
    render(<ReachSection email="test@atlas.test" />);
    expect(screen.getByText("test@atlas.test")).toBeInTheDocument();
  });

  it("renders website when provided", () => {
    render(<ReachSection website="https://atlas.test" />);
    expect(screen.getByText("https://atlas.test")).toBeInTheDocument();
  });

  it("renders phone when provided", () => {
    render(<ReachSection phone="555-1234" />);
    expect(screen.getByText("555-1234")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "555-1234" })).toHaveAttribute("href", "tel:555-1234");
  });

  it("renders all contact fields together", () => {
    render(<ReachSection email="a@b.com" website="https://x.com" phone="555" />);
    expect(screen.getByText("a@b.com")).toBeInTheDocument();
    expect(screen.getByText("https://x.com")).toBeInTheDocument();
    expect(screen.getByText("555")).toBeInTheDocument();
  });
});

describe("PresenceSection", () => {
  it("returns null when no presence data is provided", () => {
    const { container } = render(<PresenceSection />);
    expect(container.innerHTML).toBe("");
  });

  it("formats first seen values as readable dates", () => {
    render(<PresenceSection firstSeen="2026-04-23T15:13:26.037731+00:00" />);
    expect(screen.getByText("Apr 23, 2026")).toBeInTheDocument();
  });

  it("renders long contact values as links", () => {
    render(
      <PresenceSection email="contact@sunvalley-workercenter.example.org" phone="602-555-0144" />,
    );
    expect(
      screen.getByRole("link", { name: "contact@sunvalley-workercenter.example.org" }),
    ).toHaveAttribute("href", "mailto:contact@sunvalley-workercenter.example.org");
    expect(screen.getByRole("link", { name: "602-555-0144" })).toHaveAttribute(
      "href",
      "tel:602-555-0144",
    );
  });
});
