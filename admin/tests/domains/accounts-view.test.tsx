// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountsView } from "@/domains/accounts/accounts-view";
import { accountLookup } from "../fixtures/admin";

describe("AccountsView", () => {
  it("shows the account and what its workspace holds and why", () => {
    render(
      <AccountsView
        isSearching={false}
        onSearch={vi.fn()}
        result={accountLookup()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Dana · dana@example.org" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/email verified/)).toBeInTheDocument();
    expect(screen.getByText("dana@example.org (owner)")).toBeInTheDocument();
    expect(
      screen.getByText(/atlas_team since .* until .* bought \(pi_1\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/atlas_research_pass since .* granted by hand/),
    ).toBeInTheDocument();
    expect(screen.getByText(/revoked: no reason recorded/)).toBeInTheDocument();
    expect(
      screen.getByText(/refund of 4.00 USD .* Charged twice/),
    ).toBeInTheDocument();
    expect(screen.getByText(/student · pending/)).toBeInTheDocument();
  });

  it("looks up only once something is typed", async () => {
    const onSearch = vi.fn();
    render(<AccountsView isSearching={false} onSearch={onSearch} />);
    const submit = screen.getByRole("button", { name: "Look up" });
    expect(submit).toBeDisabled();
    fireEvent.submit(
      screen.getByRole("textbox").closest("form") ?? document.body,
    );
    expect(onSearch).not.toHaveBeenCalled();

    await userEvent.type(
      screen.getByLabelText("Email or workspace slug"),
      " reno-tenants ",
    );
    await userEvent.click(submit);

    expect(onSearch).toHaveBeenCalledWith("reno-tenants");
  });

  it("says plainly when nothing matches or the account has no workspace", () => {
    const { rerender } = render(
      <AccountsView
        isSearching={false}
        onSearch={vi.fn()}
        result={{ account: null, workspaces: [] }}
      />,
    );
    expect(
      screen.getByText("Nothing matches that email or slug."),
    ).toBeInTheDocument();

    const lone = accountLookup();
    rerender(
      <AccountsView
        isSearching={false}
        onSearch={vi.fn()}
        result={{
          account: lone.account
            ? { ...lone.account, email_verified: false }
            : null,
          workspaces: [],
        }}
      />,
    );
    expect(
      screen.getByText("This account belongs to no workspace."),
    ).toBeInTheDocument();
    expect(screen.getByText(/email not verified/)).toBeInTheDocument();
  });

  it("shows an empty workspace and a search in progress", () => {
    const [workspace] = accountLookup().workspaces;
    render(
      <AccountsView
        errorMessage="The lookup could not be made."
        isSearching
        onSearch={vi.fn()}
        result={{
          account: null,
          workspaces: workspace
            ? [
                {
                  ...workspace,
                  adjustments: [],
                  discounts: [],
                  products: [],
                  purchases: [],
                },
              ]
            : [],
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Looking…" })).toBeDisabled();
    expect(screen.getByText("No products.")).toBeInTheDocument();
    expect(screen.getByText("No purchases.")).toBeInTheDocument();
    expect(screen.queryByText("Refunds")).toBeNull();
    expect(screen.queryByText("Discount requests")).toBeNull();
    expect(
      screen.getByText("The lookup could not be made."),
    ).toBeInTheDocument();
  });
});
