// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OrganizationPageFeedback } from "@/domains/access/components/organization/organization-page-feedback";

describe("OrganizationPageFeedback", () => {
  it("renders the flash message when provided", () => {
    render(<OrganizationPageFeedback errorMessage={null} flashMessage="Success!" />);
    expect(screen.getByText("Success!")).toBeInTheDocument();
  });

  it("renders the error message when provided", () => {
    render(<OrganizationPageFeedback errorMessage="Error!" flashMessage={null} />);
    expect(screen.getByText("Error!")).toBeInTheDocument();
  });

  it("renders nothing when both are null", () => {
    const { container } = render(
      <OrganizationPageFeedback errorMessage={null} flashMessage={null} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
