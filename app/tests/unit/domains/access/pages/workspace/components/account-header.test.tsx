// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AccountLayout } from "@/domains/access/pages/workspace/components/account/layout";

afterEach(() => {
  cleanup();
});

describe("AccountLayout", () => {
  it("renders the account heading and email when the name is missing", () => {
    render(
      <AccountLayout
        email="ops@atlas.test"
        errorMessage={null}
        flashMessage={null}
        name={undefined}
        tabs={[]}
      >
        <div />
      </AccountLayout>,
    );

    expect(screen.getByRole("heading", { name: "Account" })).not.toBeNull();
    expect(screen.getByText("ops@atlas.test")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Sign out/ })).toBeNull();
    expect(screen.queryByText(/Manage your Atlas profile/)).toBeNull();
  });

  it("renders the stored name and email", () => {
    render(
      <AccountLayout
        email="person@atlas.test"
        errorMessage={null}
        flashMessage={null}
        name="Willie"
        tabs={[]}
      >
        <div />
      </AccountLayout>,
    );

    expect(screen.getByText("Willie")).not.toBeNull();
    expect(screen.getByText("person@atlas.test")).not.toBeNull();
  });

  it("renders only the heading when identity data is unavailable", () => {
    render(
      <AccountLayout
        email={undefined}
        errorMessage={null}
        flashMessage={null}
        name={null}
        tabs={[]}
      >
        <div />
      </AccountLayout>,
    );

    expect(screen.getByRole("heading", { name: "Account" })).not.toBeNull();
    expect(screen.queryByText("Signed-in user")).toBeNull();
  });
});
