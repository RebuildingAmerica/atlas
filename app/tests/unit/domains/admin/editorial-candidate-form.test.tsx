// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorialCandidateForm } from "@/domains/admin/editorial-candidate-form";

describe("EditorialCandidateForm", () => {
  it("prefills an existing profile but still requires a new source check", () => {
    const onSubmit = vi.fn();
    render(
      <EditorialCandidateForm
        heading="Improve existing organization"
        initial={{
          name: "NAACP Las Vegas Branch #1111",
          description: "Local branch working on housing access.",
          city: "Las Vegas",
          state: "NV",
          geo_specificity: "local",
          region: null,
          issue_areas: ["housing_affordability"],
          source_url: "https://www.naacplasvegas.org/housing",
          source_context: "",
          action_url: "https://www.naacplasvegas.org/housing",
        }}
        issueAreas={[{ name: "Housing affordability", slug: "housing_affordability" }]}
        onSubmit={onSubmit}
        pending={false}
        submitLabel="Propose correction"
      />,
    );
    expect(screen.getByRole("textbox", { name: /Organization name/ })).toHaveValue(
      "NAACP Las Vegas Branch #1111",
    );
    expect(screen.getByRole("textbox", { name: "City" })).toHaveValue("Las Vegas");
    expect(screen.getByRole("button", { name: "Propose correction" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /What the page supports/ }), {
      target: { value: "The official committee page describes housing access work." },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked both official pages/ }));
    fireEvent.click(screen.getByRole("button", { name: "Propose correction" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "NAACP Las Vegas Branch #1111",
        issue_areas: ["housing_affordability"],
      }),
    );
  });

  it("requires an official source, public action, issue, and editor check", () => {
    const onSubmit = vi.fn();
    const issueAreas = [{ name: "Public transit", slug: "public_transit" }];
    const { container, rerender } = render(
      <EditorialCandidateForm issueAreas={issueAreas} onSubmit={onSubmit} pending={false} />,
    );

    const submit = screen.getByRole("button", { name: "Add to review queue" });
    expect(submit).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "City" })).toHaveValue("");
    fireEvent.change(screen.getByRole("textbox", { name: /Organization name/ }), {
      target: { value: "Las Vegans for Better Transit" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /What the organization does/ }), {
      target: { value: "Las Vegas Valley group organizing residents for better transit." },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "City" }), {
      target: { value: "Las Vegas" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Official page supporting this work/ }), {
      target: { value: "https://lasvegasfortransit.org/about/" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /What the page supports/ }), {
      target: { value: "The About page describes education and advocacy." },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Official next step/ }), {
      target: { value: "https://lasvegasfortransit.org/join/" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Issue area" }), {
      target: { value: "public_transit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add issue area" }));
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked both official pages/ }));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Las Vegans for Better Transit",
      description: "Las Vegas Valley group organizing residents for better transit.",
      city: "Las Vegas",
      state: "NV",
      geo_specificity: "local",
      region: null,
      issue_areas: ["public_transit"],
      source_url: "https://lasvegasfortransit.org/about/",
      source_context: "The About page describes education and advocacy.",
      action_url: "https://lasvegasfortransit.org/join/",
      sources_checked: true,
    });
    rerender(<EditorialCandidateForm issueAreas={issueAreas} onSubmit={onSubmit} pending />);
    fireEvent.submit(container.firstElementChild as HTMLFormElement);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable error without clearing the researched facts", () => {
    const issueAreas = [{ name: "Public transit", slug: "public_transit" }];
    render(
      <EditorialCandidateForm
        error="The organization could not be queued. Check for an existing profile."
        issueAreas={issueAreas}
        onSubmit={vi.fn()}
        pending={false}
      />,
    );
    expect(screen.getByText(/could not be queued/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "City" })).toHaveValue("");
  });

  it("rejects unsafe and mismatched links, and supports a statewide source with no city", () => {
    const onSubmit = vi.fn();
    const issueAreas = [{ name: "Housing affordability", slug: "housing_affordability" }];
    const { container } = render(
      <EditorialCandidateForm issueAreas={issueAreas} onSubmit={onSubmit} pending={false} />,
    );
    fireEvent.submit(container.firstElementChild as HTMLFormElement);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: /Organization name/ }), {
      target: { value: "Nevada Housing Coalition" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /What the organization does/ }), {
      target: { value: "Statewide affordable-housing policy coalition." },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "City" }), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Geographic scope" }), {
      target: { value: "regional" },
    });
    expect(screen.getByRole("button", { name: "Add to review queue" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Geographic scope" }), {
      target: { value: "statewide" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Region, if needed/ }), {
      target: { value: "Nevada" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Official page supporting this work/ }), {
      target: { value: "not a URL" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /What the page supports/ }), {
      target: { value: "The site describes statewide housing policy work." },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Official next step/ }), {
      target: { value: "http://nvhousingcoalition.org/membership" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Issue area" }), {
      target: { value: "housing_affordability" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add issue area" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked both official pages/ }));
    expect(screen.getByRole("button", { name: "Add to review queue" })).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: /Official page supporting this work/ }), {
      target: { value: "https://www.nvhousingcoalition.org/about" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Official next step/ }), {
      target: { value: "https://other.org/join" },
    });
    expect(screen.getByText(/must be on the same official site/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to review queue" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /Official next step/ }), {
      target: { value: "https://nvhousingcoalition.org/membership/become-a-member/" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "State" }), {
      target: { value: "N" },
    });
    expect(screen.getByRole("button", { name: "Add to review queue" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "State" }), {
      target: { value: "nv" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to review queue" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        city: null,
        state: "NV",
        region: "Nevada",
        geo_specificity: "statewide",
      }),
    );
  });

  it("accepts a documented regional service area without inventing a city", () => {
    const onSubmit = vi.fn();
    render(
      <EditorialCandidateForm
        issueAreas={[{ name: "Transportation and mobility", slug: "transportation_and_mobility" }]}
        onSubmit={onSubmit}
        pending={false}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /Organization name/ }), {
      target: { value: "Southern Nevada Bicycle Coalition" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /What the organization does/ }), {
      target: { value: "A coalition advocating safer roads across Southern Nevada." },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Geographic scope" }), {
      target: { value: "regional" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Region, if needed/ }), {
      target: { value: "Southern Nevada" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Official page supporting this work/ }), {
      target: { value: "https://www.snvbc.org/" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /What the page supports/ }), {
      target: { value: "The official site describes Southern Nevada bicycle advocacy." },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Official next step/ }), {
      target: { value: "https://www.snvbc.org/join-for-free/" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Issue area" }), {
      target: { value: "transportation_and_mobility" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add issue area" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked both official pages/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add to review queue" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        city: null,
        geo_specificity: "regional",
        region: "Southern Nevada",
      }),
    );
  });

  it("keeps a pending submission stable and lets an editor remove an issue", () => {
    const onSubmit = vi.fn();
    const issueAreas = [{ name: "Public transit", slug: "public_transit" }];
    const { container, rerender } = render(
      <EditorialCandidateForm issueAreas={issueAreas} onSubmit={onSubmit} pending={false} />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Issue area" }), {
      target: { value: "public_transit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add issue area" }));
    rerender(<EditorialCandidateForm issueAreas={[]} onSubmit={onSubmit} pending />);
    expect(screen.getByText("Issue areas unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove public_transit" })).toBeInTheDocument();
    fireEvent.submit(container.firstElementChild as HTMLFormElement);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove public_transit" }));
    expect(screen.queryByRole("button", { name: "Remove public_transit" })).not.toBeInTheDocument();
  });
});
