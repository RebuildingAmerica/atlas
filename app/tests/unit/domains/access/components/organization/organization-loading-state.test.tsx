// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OrganizationLoadingState } from "@/domains/access/components/organization/organization-loading-state";

describe("OrganizationLoadingState", () => {
  it("renders the loading message", () => {
    render(<OrganizationLoadingState />);
    expect(screen.getByText(/Loading workspace details/i)).toBeInTheDocument();
  });
});
