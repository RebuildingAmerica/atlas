import { describe, expect, it } from "vitest";
import {
  groupStoredProvidersByWorkspace,
  resolveStoredProviderType,
  resolveStoredWorkspaceSSOSignIn,
} from "@/domains/access/sso-sign-in-resolution";
import type {
  StoredWorkspaceIdentity,
  StoredWorkspaceSSOProvider,
} from "@/domains/access/server/sso-provider-store";

describe("sso-sign-in-resolution", () => {
  describe("resolveStoredProviderType", () => {
    it("returns saml when both are present", () => {
      const provider: StoredWorkspaceSSOProvider = {
        domain: "atlas.test",
        domainVerified: true,
        hasOIDC: true,
        hasSAML: true,
        issuer: "https://accounts.google.com",
        organizationId: "org_1",
        providerId: "provider_1",
        spMetadataUrl: "",
      };
      expect(resolveStoredProviderType(provider)).toBe("saml");
    });

    it("returns oidc when only oidc is present", () => {
      const provider: StoredWorkspaceSSOProvider = {
        domain: "atlas.test",
        domainVerified: true,
        hasOIDC: true,
        hasSAML: false,
        issuer: "https://accounts.google.com",
        organizationId: "org_1",
        providerId: "provider_1",
        spMetadataUrl: "",
      };
      expect(resolveStoredProviderType(provider)).toBe("oidc");
    });
  });

  describe("groupStoredProvidersByWorkspace", () => {
    it("groups verified providers by organization id", () => {
      const providers: StoredWorkspaceSSOProvider[] = [
        {
          domain: "atlas.test",
          domainVerified: true,
          hasOIDC: true,
          hasSAML: false,
          issuer: "https://accounts.google.com",
          organizationId: "org_1",
          providerId: "provider_1",
          spMetadataUrl: "",
        },
        {
          domain: "atlas.test",
          domainVerified: true,
          hasOIDC: true,
          hasSAML: false,
          issuer: "https://accounts.google.com",
          organizationId: "org_1",
          providerId: "provider_2",
          spMetadataUrl: "",
        },
        {
          domain: "other.test",
          domainVerified: true,
          hasOIDC: true,
          hasSAML: false,
          issuer: "https://accounts.google.com",
          organizationId: "org_2",
          providerId: "provider_3",
          spMetadataUrl: "",
        },
        {
          domain: "atlas.test",
          domainVerified: false,
          hasOIDC: true,
          hasSAML: false,
          issuer: "https://accounts.google.com",
          organizationId: "org_3",
          providerId: "provider_4",
          spMetadataUrl: "",
        },
      ];

      const grouped = groupStoredProvidersByWorkspace({
        emailDomain: "atlas.test",
        storedProviders: providers,
      });

      expect(grouped.size).toBe(1);
      expect(grouped.get("org_1")).toHaveLength(2);
    });
  });

  describe("resolveStoredWorkspaceSSOSignIn", () => {
    it("resolves the preferred provider for a workspace", () => {
      const identity: StoredWorkspaceIdentity = {
        id: "org_123",
        name: "Atlas",
        primaryProviderId: "google-oidc",
        slug: "atlas",
      };
      const providers: StoredWorkspaceSSOProvider[] = [
        {
          domain: "atlas.test",
          domainVerified: true,
          hasOIDC: true,
          hasSAML: false,
          issuer: "https://accounts.google.com",
          organizationId: "org_123",
          providerId: "google-oidc",
          spMetadataUrl: "",
        },
      ];

      const resolution = resolveStoredWorkspaceSSOSignIn({
        emailDomain: "atlas.test",
        workspaceIdentity: identity,
        workspaceProviders: providers,
      });

      expect(resolution).toEqual({
        organizationName: "Atlas",
        organizationSlug: "atlas",
        providerId: "google-oidc",
        providerType: "oidc",
      });
    });

    it("returns null when no preferred provider is found", () => {
      const identity: StoredWorkspaceIdentity = {
        id: "org_123",
        name: "Atlas",
        primaryProviderId: null,
        slug: "atlas",
      };
      const resolution = resolveStoredWorkspaceSSOSignIn({
        emailDomain: "atlas.test",
        workspaceIdentity: identity,
        workspaceProviders: [],
      });
      expect(resolution).toBeNull();
    });
  });
});
