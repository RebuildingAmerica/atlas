// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import { IssueFootprint } from "@/domains/catalog/components/profiles/issue-footprint";
import { ProfileHeader } from "@/domains/catalog/components/profiles/profile-header";
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

  it("falls back to humanized slug when label is missing", () => {
    render(<IssueFootprint issueAreas={["housing_affordability"]} />);
    expect(screen.getByText("Housing Affordability")).toBeInTheDocument();
  });

  it("ignores unknown slugs", () => {
    const { container } = render(<IssueFootprint issueAreas={["unknown_slug"]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("ProfileHeader", () => {
  const baseProps = {
    type: "person" as const,
    name: "Jane Doe",
    avatarName: "Jane Doe",
    verified: false,
    sourceCount: 3,
    location: "Texas",
    geoSpecificity: "state",
  };

  it("renders name and source count", () => {
    render(<ProfileHeader {...baseProps} />);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("3 sources")).toBeInTheDocument();
  });

  it("shows singular source label", () => {
    render(<ProfileHeader {...baseProps} sourceCount={1} />);
    expect(screen.getByText("1 source")).toBeInTheDocument();
  });

  it("shows verified badge when verified", () => {
    render(<ProfileHeader {...baseProps} verified={true} />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("does not show verified badge when unverified", () => {
    render(<ProfileHeader {...baseProps} />);
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });

  it("renders subtitle when provided", () => {
    render(<ProfileHeader {...baseProps} subtitle={<span>Subtitle text</span>} />);
    expect(screen.getByText("Subtitle text")).toBeInTheDocument();
  });

  it("omits subtitle when not provided", () => {
    const { container } = render(<ProfileHeader {...baseProps} />);
    expect(container.querySelector(".mt-1.text-white\\/60")).not.toBeInTheDocument();
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
  });

  it("renders all contact fields together", () => {
    render(<ReachSection email="a@b.com" website="https://x.com" phone="555" />);
    expect(screen.getByText("a@b.com")).toBeInTheDocument();
    expect(screen.getByText("https://x.com")).toBeInTheDocument();
    expect(screen.getByText("555")).toBeInTheDocument();
  });
});
