// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AccountHeader } from "@/domains/access/pages/workspace/components/account-header";

afterEach(() => {
  cleanup();
});

describe("AccountHeader", () => {
  it("renders the account heading and email when the name is missing", () => {
    render(<AccountHeader email="ops@atlas.test" name={undefined} />);

    expect(screen.getByRole("heading", { name: "Account" })).not.toBeNull();
    expect(screen.getByText("ops@atlas.test")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Sign out/ })).toBeNull();
    expect(screen.queryByText(/Manage your Atlas profile/)).toBeNull();
  });

  it("renders the stored name and email", () => {
    render(<AccountHeader email="person@atlas.test" name="Willie" />);

    expect(screen.getByText("Willie")).not.toBeNull();
    expect(screen.getByText("person@atlas.test")).not.toBeNull();
  });

  it("renders only the heading when identity data is unavailable", () => {
    render(<AccountHeader email={undefined} name={null} />);

    expect(screen.getByRole("heading", { name: "Account" })).not.toBeNull();
    expect(screen.queryByText("Signed-in user")).toBeNull();
  });
});
