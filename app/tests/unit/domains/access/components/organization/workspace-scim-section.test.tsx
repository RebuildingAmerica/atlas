// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSCIMSection } from "@/domains/access/components/organization/workspace-scim-section";
import { renderWithProviders } from "../../../../../helpers/render-with-providers";

const mocks = vi.hoisted(() => ({
  deleteWorkspaceSCIMProviderConnection: vi.fn(),
  generateWorkspaceSCIMToken: vi.fn(),
  loadWorkspaceSCIMSetup: vi.fn(),
}));

vi.mock("@/domains/access/scim.functions", () => ({
  deleteWorkspaceSCIMProviderConnection: mocks.deleteWorkspaceSCIMProviderConnection,
  generateWorkspaceSCIMToken: mocks.generateWorkspaceSCIMToken,
  loadWorkspaceSCIMSetup: mocks.loadWorkspaceSCIMSetup,
}));

describe("WorkspaceSCIMSection", () => {
  beforeEach(() => {
    mocks.loadWorkspaceSCIMSetup.mockResolvedValue({
      defaultProviderId: "atlas-team-scim",
      providers: [{ id: "conn_1", organizationId: "org_team", providerId: "okta-scim" }],
      scimBaseUrl: "https://atlas.test/api/auth/scim/v2",
      serviceProviderConfigUrl: "https://atlas.test/api/auth/scim/v2/ServiceProviderConfig",
      usersUrl: "https://atlas.test/api/auth/scim/v2/Users",
    });
    mocks.generateWorkspaceSCIMToken.mockResolvedValue({
      defaultProviderId: "atlas-team-scim",
      providerId: "atlas-team-scim",
      providers: [{ id: "conn_1", organizationId: "org_team", providerId: "okta-scim" }],
      scimBaseUrl: "https://atlas.test/api/auth/scim/v2",
      scimToken: "scim_secret_token",
      serviceProviderConfigUrl: "https://atlas.test/api/auth/scim/v2/ServiceProviderConfig",
      usersUrl: "https://atlas.test/api/auth/scim/v2/Users",
    });
    mocks.deleteWorkspaceSCIMProviderConnection.mockResolvedValue({ ok: true });
  });

  it("tells a non-admin that SCIM is out of their hands, and asks the server nothing", () => {
    renderWithProviders(<WorkspaceSCIMSection canManageOrganization={false} />);

    expect(screen.getByText("Only workspace admins can manage SCIM.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate token" })).toBeNull();
    expect(mocks.loadWorkspaceSCIMSetup).not.toHaveBeenCalled();
  });

  it("hands an admin the endpoints their IdP needs and prefills the provider id", async () => {
    renderWithProviders(<WorkspaceSCIMSection canManageOrganization />);

    expect(screen.getByText("Loading")).toBeInTheDocument();

    expect(
      await screen.findByDisplayValue("https://atlas.test/api/auth/scim/v2"),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("https://atlas.test/api/auth/scim/v2/Users"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Provider ID")).toHaveValue("atlas-team-scim");
    expect(screen.getByText("okta-scim")).toBeInTheDocument();
    expect(screen.queryByText("Loading")).toBeNull();
  });

  it("says so when SCIM setup cannot be read", async () => {
    mocks.loadWorkspaceSCIMSetup.mockRejectedValue(new Error("boom"));

    renderWithProviders(<WorkspaceSCIMSection canManageOrganization />);

    expect(await screen.findByText("SCIM setup is unavailable.")).toBeInTheDocument();
    expect(screen.getByText("No SCIM connections.")).toBeInTheDocument();
  });

  it("reports a workspace with no SCIM connections yet", async () => {
    mocks.loadWorkspaceSCIMSetup.mockResolvedValue({
      defaultProviderId: "atlas-team-scim",
      providers: [],
      scimBaseUrl: "https://atlas.test/api/auth/scim/v2",
      serviceProviderConfigUrl: "https://atlas.test/api/auth/scim/v2/ServiceProviderConfig",
      usersUrl: "https://atlas.test/api/auth/scim/v2/Users",
    });

    renderWithProviders(<WorkspaceSCIMSection canManageOrganization />);

    expect(await screen.findByText("No SCIM connections.")).toBeInTheDocument();
  });

  it("shows the bearer token exactly once after an admin generates it", async () => {
    renderWithProviders(<WorkspaceSCIMSection canManageOrganization />);

    await waitFor(() => {
      expect(screen.getByLabelText("Provider ID")).toHaveValue("atlas-team-scim");
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate token" }));

    expect(await screen.findByDisplayValue("scim_secret_token")).toBeInTheDocument();
    expect(await screen.findByText("SCIM token generated.")).toBeInTheDocument();
    expect(mocks.generateWorkspaceSCIMToken.mock.calls[0]?.[0]).toEqual({
      data: { providerId: "atlas-team-scim" },
    });
  });

  it("says it is working while the token is being minted", async () => {
    let issueToken: (result: unknown) => void = () => undefined;
    mocks.generateWorkspaceSCIMToken.mockReturnValue(
      new Promise((resolve) => {
        issueToken = resolve;
      }),
    );

    renderWithProviders(<WorkspaceSCIMSection canManageOrganization />);

    await waitFor(() => {
      expect(screen.getByLabelText("Provider ID")).toHaveValue("atlas-team-scim");
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate token" }));

    expect(await screen.findByRole("button", { name: "Generating..." })).toBeDisabled();
    expect(screen.getByLabelText("Provider ID")).toBeDisabled();

    issueToken({
      defaultProviderId: "atlas-team-scim",
      providerId: "atlas-team-scim",
      providers: [],
      scimBaseUrl: "https://atlas.test/api/auth/scim/v2",
      scimToken: "scim_secret_token",
      serviceProviderConfigUrl: "https://atlas.test/api/auth/scim/v2/ServiceProviderConfig",
      usersUrl: "https://atlas.test/api/auth/scim/v2/Users",
    });

    expect(await screen.findByDisplayValue("scim_secret_token")).toBeInTheDocument();
  });

  it("explains why a token could not be issued", async () => {
    mocks.generateWorkspaceSCIMToken.mockRejectedValue(
      new Error("SCIM setup is available on Atlas Team."),
    );

    renderWithProviders(<WorkspaceSCIMSection canManageOrganization />);

    await waitFor(() => {
      expect(screen.getByLabelText("Provider ID")).toHaveValue("atlas-team-scim");
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate token" }));

    expect(await screen.findByText("SCIM setup is available on Atlas Team.")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("scim_secret_token")).toBeNull();
  });

  it("falls back to safe copy when the token failure carries no message", async () => {
    mocks.generateWorkspaceSCIMToken.mockRejectedValue("upstream exploded");

    renderWithProviders(<WorkspaceSCIMSection canManageOrganization />);

    await waitFor(() => {
      expect(screen.getByLabelText("Provider ID")).toHaveValue("atlas-team-scim");
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate token" }));

    expect(await screen.findByText("Atlas could not generate a SCIM token.")).toBeInTheDocument();
  });

  it("does not ask for a token while there is no provider id to ask for", async () => {
    mocks.loadWorkspaceSCIMSetup.mockRejectedValue(new Error("boom"));

    renderWithProviders(<WorkspaceSCIMSection canManageOrganization />);

    await screen.findByText("SCIM setup is unavailable.");
    const submit = screen.getByRole("button", { name: "Generate token" });
    expect(submit).toBeDisabled();
    expect(screen.getByLabelText("Provider ID")).toHaveValue("");

    const form = submit.closest("form");
    if (!form) throw new Error("Expected the SCIM token form to render");
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mocks.generateWorkspaceSCIMToken).not.toHaveBeenCalled();
    });
  });

  it("restores the suggested provider id when an admin clears the field", async () => {
    renderWithProviders(<WorkspaceSCIMSection canManageOrganization />);

    const providerIdField = await screen.findByLabelText("Provider ID");
    fireEvent.change(providerIdField, { target: { value: "" } });

    await waitFor(() => {
      expect(providerIdField).toHaveValue("atlas-team-scim");
    });
  });

  it("removes a connection and drops the token that belonged to it", async () => {
    renderWithProviders(<WorkspaceSCIMSection canManageOrganization />);

    const providerIdField = await screen.findByLabelText("Provider ID");
    fireEvent.change(providerIdField, { target: { value: "okta-scim" } });
    mocks.generateWorkspaceSCIMToken.mockResolvedValue({
      defaultProviderId: "atlas-team-scim",
      providerId: "okta-scim",
      providers: [{ id: "conn_1", organizationId: "org_team", providerId: "okta-scim" }],
      scimBaseUrl: "https://atlas.test/api/auth/scim/v2",
      scimToken: "scim_secret_token",
      serviceProviderConfigUrl: "https://atlas.test/api/auth/scim/v2/ServiceProviderConfig",
      usersUrl: "https://atlas.test/api/auth/scim/v2/Users",
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate token" }));
    expect(await screen.findByDisplayValue("scim_secret_token")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("SCIM connection removed.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByDisplayValue("scim_secret_token")).toBeNull();
    });
    expect(mocks.deleteWorkspaceSCIMProviderConnection.mock.calls[0]?.[0]).toEqual({
      data: { providerId: "okta-scim" },
    });
  });

  it("keeps a token that belongs to a different connection than the one removed", async () => {
    renderWithProviders(<WorkspaceSCIMSection canManageOrganization />);

    await waitFor(() => {
      expect(screen.getByLabelText("Provider ID")).toHaveValue("atlas-team-scim");
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate token" }));
    expect(await screen.findByDisplayValue("scim_secret_token")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("SCIM connection removed.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("scim_secret_token")).toBeInTheDocument();
  });

  it("explains a connection Atlas could not remove", async () => {
    mocks.deleteWorkspaceSCIMProviderConnection.mockRejectedValue(new Error("still in use"));

    renderWithProviders(<WorkspaceSCIMSection canManageOrganization />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    expect(await screen.findByText("still in use")).toBeInTheDocument();
  });

  it("falls back to safe copy when the removal failure carries no message", async () => {
    mocks.deleteWorkspaceSCIMProviderConnection.mockRejectedValue("upstream exploded");

    renderWithProviders(<WorkspaceSCIMSection canManageOrganization />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    expect(
      await screen.findByText("Atlas could not remove that SCIM connection."),
    ).toBeInTheDocument();
  });
});
