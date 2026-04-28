import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  deleteWorkspaceSSOProvider,
  registerWorkspaceGoogleOIDCProvider,
  registerWorkspaceSAMLProvider,
  requestWorkspaceSSODomainVerification,
  rotateWorkspaceSAMLCertificate,
  setWorkspacePrimarySSOProvider,
  verifyWorkspaceSSODomain,
} from "@/domains/access/sso.functions";
import {
  runOrganizationPageMutation,
  type OrganizationPageMutationFeedback,
} from "./organization-page-mutation-helpers";
import type { OrganizationPageForms } from "./use-organization-page-forms";

/**
 * SSO-management mutations and handlers for the organization page.
 */
export interface OrganizationPageSSOActions {
  domainVerificationTokens: Record<string, string>;
  ssoMutationPending: boolean;
  onDeleteSSOProvider: (providerId: string) => Promise<void>;
  onOidcFormSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onRequestDomainVerification: (providerId: string) => Promise<void>;
  onRotateSAMLCertificate: (providerId: string, certificate: string) => Promise<void>;
  onSamlFormSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onSavePrimaryProvider: (providerId: string | null) => Promise<void>;
  onVerifyDomain: (providerId: string) => Promise<void>;
}

interface UseOrganizationPageSSOActionsParams {
  feedback: OrganizationPageMutationFeedback;
  forms: OrganizationPageForms;
  refreshWorkspaceData: () => Promise<void>;
}

/**
 * Enterprise SSO action hook for the organization page.
 *
 * @param params - The shared page state and helpers.
 * @param params.feedback - Shared flash/error setters.
 * @param params.forms - The current organization-page forms.
 * @param params.refreshWorkspaceData - Shared query refresh callback.
 */
export function useOrganizationPageSSOActions(
  params: UseOrganizationPageSSOActionsParams,
): OrganizationPageSSOActions {
  const [domainVerificationTokens, setDomainVerificationTokens] = useState<Record<string, string>>(
    {},
  );
  const registerWorkspaceGoogleOIDCProviderMutation = useMutation({
    mutationFn: registerWorkspaceGoogleOIDCProvider,
  });
  const registerWorkspaceSAMLProviderMutation = useMutation({
    mutationFn: registerWorkspaceSAMLProvider,
  });
  const setWorkspacePrimarySSOProviderMutation = useMutation({
    mutationFn: setWorkspacePrimarySSOProvider,
  });
  const requestWorkspaceSSODomainVerificationMutation = useMutation({
    mutationFn: requestWorkspaceSSODomainVerification,
  });
  const verifyWorkspaceSSODomainMutation = useMutation({
    mutationFn: verifyWorkspaceSSODomain,
  });
  const deleteWorkspaceSSOProviderMutation = useMutation({
    mutationFn: deleteWorkspaceSSOProvider,
  });
  const rotateWorkspaceSAMLCertificateMutation = useMutation({
    mutationFn: rotateWorkspaceSAMLCertificate,
  });

  /**
   * Registers the current Google Workspace OIDC form as a new provider.
   *
   * @param event - The OIDC setup form submit event.
   */
  async function handleOidcSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runOrganizationPageMutation({
      action: async () => {
        const mutationResult = await registerWorkspaceGoogleOIDCProviderMutation.mutateAsync({
          data: params.forms.oidcSetupForm,
        });
        const { domainVerificationToken, providerId } = mutationResult;

        setDomainVerificationTokens((current) => ({
          ...current,
          [providerId]: domainVerificationToken,
        }));

        params.forms.setOidcSetupForm((current) => ({
          ...current,
          clientId: "",
          clientSecret: "",
        }));

        return mutationResult;
      },
      fallbackMessage: "Atlas could not save that Google Workspace OIDC provider.",
      feedback: params.feedback,
      refreshWorkspaceData: params.refreshWorkspaceData,
      successMessage: "Google Workspace OIDC saved.",
    });
  }

  /**
   * Registers the current Google Workspace SAML form as a new provider.
   *
   * @param event - The SAML setup form submit event.
   */
  async function handleSamlSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runOrganizationPageMutation({
      action: async () => {
        const mutationResult = await registerWorkspaceSAMLProviderMutation.mutateAsync({
          data: params.forms.samlSetupForm,
        });
        const { domainVerificationToken, providerId } = mutationResult;

        setDomainVerificationTokens((current) => ({
          ...current,
          [providerId]: domainVerificationToken,
        }));

        params.forms.setSamlSetupForm((current) => ({
          ...current,
          certificate: "",
          entryPoint: "",
          issuer: "",
        }));

        return mutationResult;
      },
      fallbackMessage: "Atlas could not save that Google Workspace SAML provider.",
      feedback: params.feedback,
      refreshWorkspaceData: params.refreshWorkspaceData,
      successMessage: "Google Workspace SAML saved.",
    });
  }

  /**
   * Saves one workspace-level primary provider choice.
   *
   * @param providerId - The provider id to promote, or `null` to clear.
   */
  async function handleSavePrimaryProvider(providerId: string | null) {
    await runOrganizationPageMutation({
      action: async () => {
        const mutationResult = await setWorkspacePrimarySSOProviderMutation.mutateAsync({
          data: {
            providerId,
          },
        });

        return mutationResult;
      },
      fallbackMessage: "Atlas could not change the primary enterprise provider.",
      feedback: params.feedback,
      refreshWorkspaceData: params.refreshWorkspaceData,
      successMessage: "Primary provider updated.",
    });
  }

  /**
   * Requests a fresh DNS verification token for one provider.
   *
   * @param providerId - The provider id to refresh.
   */
  async function handleRequestDomainVerification(providerId: string) {
    await runOrganizationPageMutation({
      action: async () => {
        const mutationResult = await requestWorkspaceSSODomainVerificationMutation.mutateAsync({
          data: {
            providerId,
          },
        });
        const { domainVerificationToken } = mutationResult;

        setDomainVerificationTokens((current) => ({
          ...current,
          [providerId]: domainVerificationToken,
        }));

        return mutationResult;
      },
      fallbackMessage: "Atlas could not issue a new domain verification token.",
      feedback: params.feedback,
      refreshWorkspaceData: params.refreshWorkspaceData,
      successMessage: "Fresh verification token issued.",
    });
  }

  /**
   * Verifies one provider's domain after the operator adds the DNS record.
   *
   * @param providerId - The provider id to verify.
   */
  async function handleVerifyDomain(providerId: string) {
    await runOrganizationPageMutation({
      action: async () => {
        const mutationResult = await verifyWorkspaceSSODomainMutation.mutateAsync({
          data: {
            providerId,
          },
        });

        setDomainVerificationTokens((current) => {
          const { [providerId]: _, ...nextTokens } = current;

          return nextTokens;
        });

        return mutationResult;
      },
      fallbackMessage: "Atlas could not verify that domain yet.",
      feedback: params.feedback,
      refreshWorkspaceData: params.refreshWorkspaceData,
      successMessage: "Domain verified.",
    });
  }

  /**
   * Rotates the X.509 signing certificate on one configured SAML provider.
   *
   * @param providerId - The provider id whose certificate is being rotated.
   * @param certificate - The new PEM-encoded certificate to install.
   */
  async function handleRotateSAMLCertificate(providerId: string, certificate: string) {
    await runOrganizationPageMutation({
      action: async () => {
        return await rotateWorkspaceSAMLCertificateMutation.mutateAsync({
          data: { certificate, providerId },
        });
      },
      fallbackMessage: "Atlas could not rotate that SAML certificate.",
      feedback: params.feedback,
      refreshWorkspaceData: params.refreshWorkspaceData,
      successMessage: "SAML certificate rotated. Domain verification was preserved.",
    });
  }

  /**
   * Deletes one configured enterprise provider from the active workspace.
   *
   * @param providerId - The provider id to delete.
   */
  async function handleDeleteSSOProvider(providerId: string) {
    await runOrganizationPageMutation({
      action: async () => {
        const mutationResult = await deleteWorkspaceSSOProviderMutation.mutateAsync({
          data: {
            providerId,
          },
        });

        setDomainVerificationTokens((current) => {
          const { [providerId]: _, ...nextTokens } = current;

          return nextTokens;
        });

        return mutationResult;
      },
      fallbackMessage: "Atlas could not delete that enterprise provider.",
      feedback: params.feedback,
      refreshWorkspaceData: params.refreshWorkspaceData,
      successMessage: "Enterprise provider removed.",
    });
  }

  const ssoMutationPending =
    registerWorkspaceGoogleOIDCProviderMutation.isPending ||
    registerWorkspaceSAMLProviderMutation.isPending ||
    setWorkspacePrimarySSOProviderMutation.isPending ||
    requestWorkspaceSSODomainVerificationMutation.isPending ||
    verifyWorkspaceSSODomainMutation.isPending ||
    rotateWorkspaceSAMLCertificateMutation.isPending ||
    deleteWorkspaceSSOProviderMutation.isPending;

  return {
    domainVerificationTokens,
    ssoMutationPending,
    onDeleteSSOProvider: handleDeleteSSOProvider,
    onOidcFormSubmit: handleOidcSubmit,
    onRequestDomainVerification: handleRequestDomainVerification,
    onRotateSAMLCertificate: handleRotateSAMLCertificate,
    onSamlFormSubmit: handleSamlSubmit,
    onSavePrimaryProvider: handleSavePrimaryProvider,
    onVerifyDomain: handleVerifyDomain,
  };
}
