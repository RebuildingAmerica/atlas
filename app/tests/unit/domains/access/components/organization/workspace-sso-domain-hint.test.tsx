// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WorkspaceSSODomainHint } from "@/domains/access/components/organization/workspace-sso-domain-hint";

describe("WorkspaceSSODomainHint", () => {
  it("renders the domain suggestion", () => {
    render(<WorkspaceSSODomainHint suggestion="atlas.test" />);
    expect(screen.getByText("atlas.test")).toBeInTheDocument();
  });
});
