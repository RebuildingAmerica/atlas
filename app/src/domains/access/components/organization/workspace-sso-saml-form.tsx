import type { AtlasWorkspaceSSOSetupValues } from "../../organization-sso-defaults";
import {
  classifyPemCertificate,
  extractIssuerOrigin,
  isLikelyFreeEmailDomain,
} from "../../sso-form-helpers";
import type { WorkspaceSAMLSetupFormState } from "./organization-page-controller";
import { SamlMetadataPasteField } from "./saml-metadata-paste-field";
import { flashClassName, usePrefillFlash } from "./use-prefill-flash";
import { WorkspaceSSOCopyField } from "./workspace-sso-copy-field";
import { WorkspaceSSODomainHint } from "./workspace-sso-domain-hint";
import { WorkspaceSSOSamlSavePreview } from "./workspace-sso-saml-save-preview";
import { Input } from "@/platform/ui/input";
import { Textarea } from "@/platform/ui/textarea";

interface WorkspaceSSOSamlFormProps {
  canManageOrganization: boolean;
  isPending: boolean;
  samlAllowedIssuerOrigins: readonly string[];
  samlSetupForm: WorkspaceSAMLSetupFormState;
  setSamlSetupForm: (
    updater: (current: WorkspaceSAMLSetupFormState) => WorkspaceSAMLSetupFormState,
  ) => void;
  setup: AtlasWorkspaceSSOSetupValues;
  onSamlSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
}

/**
 * SAML 2.0 configuration article — copyable Atlas-side ACS / metadata
 * / entity values plus the form admins fill in to register an IdP-side
 * SAML application.  Includes the metadata-XML paste shortcut, the
 * inline allowlist + PEM checks, and the prefill ring-flash on filled
 * inputs.
 */
export function WorkspaceSSOSamlForm({
  canManageOrganization,
  isPending,
  samlAllowedIssuerOrigins,
  samlSetupForm,
  setSamlSetupForm,
  setup,
  onSamlSubmit,
}: WorkspaceSSOSamlFormProps) {
  const samlAllowlistEmpty = samlAllowedIssuerOrigins.length === 0;
  const samlIssuerOrigin = extractIssuerOrigin(samlSetupForm.issuer);
  const samlIssuerAllowed =
    samlIssuerOrigin !== null && samlAllowedIssuerOrigins.includes(samlIssuerOrigin);
  const samlCertificateClassification = classifyPemCertificate(samlSetupForm.certificate);
  const samlCertificateLooksValid = samlCertificateClassification.kind === "ok";
  const visibleAllowlist = canManageOrganization ? samlAllowedIssuerOrigins : [];
  const samlIssuerHelperText = samlAllowlistEmpty
    ? "SAML registration is disabled for this deployment. Email hello@rebuildingus.org to add an issuer host to the allowlist before configuring a provider."
    : samlSetupForm.issuer.trim() === ""
      ? `Allowed issuer hosts: ${visibleAllowlist.join(", ")}.`
      : samlIssuerAllowed
        ? `Issuer host (${samlIssuerOrigin ?? ""}) is on the allowlist.`
        : `Issuer host ${samlIssuerOrigin ?? "(unparseable)"} is not on the allowlist. Allowed: ${visibleAllowlist.join(", ")}.`;
  const samlDomainTrimmed = samlSetupForm.domain.trim().toLowerCase();
  const samlDomainIsFreeEmail = isLikelyFreeEmailDomain(samlDomainTrimmed);
  const hasWorkspaceDomainSuggestion = Boolean(setup.workspaceDomainSuggestion);
  const samlPrefill = usePrefillFlash();

  return (
    <article className="border-outline bg-surface space-y-5 rounded-[1.5rem] border p-6">
      <div className="space-y-2">
        <h3 className="type-title-large text-on-surface">SAML 2.0</h3>
        <p className="type-body-medium text-outline">
          Use this for organizations using a SAML identity provider.
        </p>
      </div>

      <ol className="type-body-medium text-outline list-decimal space-y-2 pl-5">
        <li>Create a custom SAML app in the customer identity provider.</li>
        <li>Paste the ACS URL, metadata URL, and entity ID shown below into that app.</li>
        <li>Copy the IdP issuer, sign-in URL, and certificate back into Atlas.</li>
        <li>Save the provider, publish the DNS TXT verification record, then verify it here.</li>
      </ol>

      <div className="grid gap-3">
        <WorkspaceSSOCopyField
          label="Suggested provider ID"
          value={setup.samlProviderIdSuggestion}
        />
        <WorkspaceSSOCopyField label="ACS URL" value={setup.samlAcsUrl} />
        <WorkspaceSSOCopyField label="SP metadata URL" value={setup.samlMetadataUrl} />
        <WorkspaceSSOCopyField label="Entity ID / audience" value={setup.samlEntityId} />
      </div>

      {canManageOrganization ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            void onSamlSubmit(e);
          }}
        >
          <SamlMetadataPasteField
            onPrefill={(metadata) => {
              const filledKeys: string[] = [];
              setSamlSetupForm((current) => {
                const next = { ...current };
                if (metadata.issuer) {
                  next.issuer = metadata.issuer;
                  filledKeys.push("issuer");
                }
                if (metadata.entryPoint) {
                  next.entryPoint = metadata.entryPoint;
                  filledKeys.push("entryPoint");
                }
                if (metadata.certificate) {
                  next.certificate = metadata.certificate;
                  filledKeys.push("certificate");
                }
                return next;
              });
              samlPrefill.flash(filledKeys);
            }}
          />
          <div className="space-y-1">
            <Input
              label="Workspace domain"
              value={samlSetupForm.domain}
              onChange={(value) => {
                setSamlSetupForm((current) => ({ ...current, domain: value }));
              }}
              placeholder={setup.workspaceDomainSuggestion || "your-org.example"}
            />
            {samlDomainIsFreeEmail ? (
              <p className="type-body-small rounded-2xl bg-amber-50 px-3 py-2 text-amber-800">
                {samlDomainTrimmed} is a consumer mailbox host. Use the domain your team actually
                receives email at — for example <code>acme.com</code>, not{" "}
                <code>{samlDomainTrimmed}</code>.
              </p>
            ) : null}
          </div>
          {hasWorkspaceDomainSuggestion ? (
            <WorkspaceSSODomainHint suggestion={setup.workspaceDomainSuggestion} />
          ) : null}
          <div className="space-y-1">
            <div className={flashClassName(samlPrefill.flashed, "issuer")}>
              <Input
                label="Identity provider issuer"
                value={samlSetupForm.issuer}
                onChange={(value) => {
                  setSamlSetupForm((current) => ({ ...current, issuer: value }));
                }}
                placeholder="https://accounts.google.com/o/saml2?idpid=..."
              />
            </div>
            <p
              className={
                samlAllowlistEmpty || (samlSetupForm.issuer.trim() !== "" && !samlIssuerAllowed)
                  ? "type-body-small text-error"
                  : "type-body-small text-outline"
              }
            >
              {samlIssuerHelperText}
              {samlAllowlistEmpty ? (
                <>
                  {" "}
                  <a
                    href="mailto:hello@rebuildingus.org?subject=Atlas%20SAML%20issuer%20allowlist"
                    className="underline"
                  >
                    Email Atlas operators
                  </a>
                  .
                </>
              ) : null}
            </p>
          </div>
          <div className={flashClassName(samlPrefill.flashed, "entryPoint")}>
            <Input
              label="Identity provider sign-in URL"
              value={samlSetupForm.entryPoint}
              onChange={(value) => {
                setSamlSetupForm((current) => ({ ...current, entryPoint: value }));
              }}
              placeholder="https://accounts.google.com/o/saml2/idp?idpid=..."
            />
          </div>
          <div className="space-y-1">
            <div className={flashClassName(samlPrefill.flashed, "certificate")}>
              <Textarea
                label="X.509 certificate"
                rows={12}
                autoExpand
                maxRows={36}
                value={samlSetupForm.certificate}
                onChange={(value) => {
                  setSamlSetupForm((current) => ({ ...current, certificate: value }));
                }}
                placeholder="-----BEGIN CERTIFICATE-----"
                className="font-mono text-sm"
              />
            </div>
            {samlCertificateClassification.kind === "invalid" ? (
              <p className="type-body-small text-error">
                {samlCertificateClassification.reason} Atlas parses the certificate server-side
                after save and shows the parsed expiry and fingerprint here.
              </p>
            ) : samlCertificateClassification.kind === "ok" ? (
              <p className="type-body-small text-outline">
                Looks like a PEM certificate ({samlCertificateClassification.bodyLines} body line
                {samlCertificateClassification.bodyLines === 1 ? "" : "s"}). Atlas will parse and
                display the expiry and fingerprint after save.
              </p>
            ) : null}
          </div>
          <details className="text-outline space-y-2">
            <summary className="type-label-medium cursor-pointer">
              Advanced: override the suggested provider ID
            </summary>
            <Input
              label="Provider ID"
              value={samlSetupForm.providerId}
              onChange={(value) => {
                setSamlSetupForm((current) => ({ ...current, providerId: value }));
              }}
              placeholder={setup.samlProviderIdSuggestion}
            />
            <p className="type-body-small text-outline">
              Keep the suggested value unless you have a reason to change it. Provider IDs must be
              unique across Atlas; collisions cause registration to fail.{" "}
              <a
                href="https://atlas.rebuildingus.org/docs/deployment/google-workspace-saml-sso"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline"
              >
                Learn more
              </a>
              .
            </p>
          </details>
          <WorkspaceSSOSamlSavePreview
            fallbackProviderId={setup.samlProviderIdSuggestion}
            isPending={isPending}
            samlCertificateLooksValid={samlCertificateLooksValid}
            samlIssuerAllowed={samlIssuerAllowed}
            samlSetupForm={samlSetupForm}
          />
        </form>
      ) : (
        <p className="type-body-medium text-outline">
          Only owners and admins can register enterprise providers.
        </p>
      )}
    </article>
  );
}
