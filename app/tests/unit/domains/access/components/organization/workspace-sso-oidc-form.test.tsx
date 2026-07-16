// @vitest-environment jsdom
/* eslint-disable atlas-tests/no-test-file-locals */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@rebuildingamerica/atlas-ui/ui/toast", () => ({
  useToast: () => ({
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

import { WorkspaceSSOOidcForm } from "@/domains/access/components/organization/workspace-sso-oidc-form";
import type { AtlasWorkspaceSSOSetupValues } from "@/domains/access/organization-sso-defaults";
import type { WorkspaceOIDCSetupFormState } from "@/domains/access/components/organization/organization-page-controller";

interface SetupOverrides {
  workspaceDomainSuggestion?: string;
}

function buildSetup(overrides: SetupOverrides = {}): AtlasWorkspaceSSOSetupValues {
  return {
    dnsTokenPrefix: "_better-auth-token",
    googleWorkspaceIssuer: "https://accounts.google.com",
    googleWorkspaceScopes: ["openid", "email", "profile"],
    oidcProviderIdSuggestion: "oidc-suggestion",
    oidcRedirectUrl: "https://atlas.test/callback",
    samlAcsUrl: "https://atlas.test/acs",
    samlEntityId: "https://atlas.test/metadata",
    samlMetadataUrl: "https://atlas.test/metadata.xml",
    samlProviderIdSuggestion: "saml-suggestion",
    workspaceDomainSuggestion: "atlas.test",
    ...overrides,
  };
}

function buildForm(
  overrides: Partial<WorkspaceOIDCSetupFormState> = {},
): WorkspaceOIDCSetupFormState {
  return {
    clientId: "",
    clientSecret: "",
    domain: "",
    providerId: "",
    setAsPrimary: false,
    ...overrides,
  };
}

describe("WorkspaceSSOOidcForm", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the article copy and the copyable Atlas-side values", () => {
    render(
      <WorkspaceSSOOidcForm
        canManageOrganization
        isPending={false}
        oidcSetupForm={buildForm()}
        setOidcSetupForm={vi.fn()}
        setup={buildSetup()}
        onOidcSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText("Google Workspace OIDC")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://accounts.google.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://atlas.test/callback")).toBeInTheDocument();
  });

  it("hides the form for non-managers", () => {
    render(
      <WorkspaceSSOOidcForm
        canManageOrganization={false}
        isPending={false}
        oidcSetupForm={buildForm()}
        setOidcSetupForm={vi.fn()}
        setup={buildSetup()}
        onOidcSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.queryByLabelText(/Workspace domain/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Only owners and admins can register enterprise providers/i),
    ).toBeInTheDocument();
  });

  it("forwards domain, client id, client secret, and provider id edits", () => {
    const setOidcSetupForm = vi.fn();
    render(
      <WorkspaceSSOOidcForm
        canManageOrganization
        isPending={false}
        oidcSetupForm={buildForm()}
        setOidcSetupForm={setOidcSetupForm}
        setup={buildSetup()}
        onOidcSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Workspace domain/i), {
      target: { value: "atlas.test" },
    });
    fireEvent.change(screen.getByLabelText(/Client ID/i), { target: { value: "client-id" } });
    fireEvent.change(screen.getByLabelText(/Client secret/i), { target: { value: "secret" } });
    fireEvent.change(screen.getByLabelText("Provider ID"), { target: { value: "manual-id" } });

    expect(setOidcSetupForm).toHaveBeenCalledTimes(4);
    const updaters = setOidcSetupForm.mock.calls.map(
      (call) => call[0] as (s: WorkspaceOIDCSetupFormState) => WorkspaceOIDCSetupFormState,
    );
    const empty = buildForm();
    expect(updaters[0]?.(empty).domain).toBe("atlas.test");
    expect(updaters[1]?.(empty).clientId).toBe("client-id");
    expect(updaters[2]?.(empty).clientSecret).toBe("secret");
    expect(updaters[3]?.(empty).providerId).toBe("manual-id");
  });

  it("warns when the workspace domain is a consumer mailbox host", () => {
    render(
      <WorkspaceSSOOidcForm
        canManageOrganization
        isPending={false}
        oidcSetupForm={buildForm({ domain: "yahoo.com" })}
        setOidcSetupForm={vi.fn()}
        setup={buildSetup()}
        onOidcSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText(/consumer mailbox host/i)).toBeInTheDocument();
  });

  it("hides the workspace-domain hint when the setup omits a suggestion", () => {
    render(
      <WorkspaceSSOOidcForm
        canManageOrganization
        isPending={false}
        oidcSetupForm={buildForm()}
        setOidcSetupForm={vi.fn()}
        setup={buildSetup({ workspaceDomainSuggestion: "" })}
        onOidcSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.queryByText(/Suggested from your signed-in email/i)).not.toBeInTheDocument();
  });

  it("invokes onOidcSubmit when the form is submitted", () => {
    const onOidcSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkspaceSSOOidcForm
        canManageOrganization
        isPending={false}
        oidcSetupForm={buildForm({
          domain: "atlas.test",
          clientId: "c",
          clientSecret: "s",
          providerId: "p",
        })}
        setOidcSetupForm={vi.fn()}
        setup={buildSetup()}
        onOidcSubmit={onOidcSubmit}
      />,
    );

    const form = screen
      .getByRole("button", { name: /Save Google Workspace OIDC/i })
      .closest("form");
    if (!form) throw new Error("Expected OIDC setup form");
    fireEvent.submit(form);
    expect(onOidcSubmit).toHaveBeenCalled();
  });
});
