import { useEffect, useState } from "react";
import type { AtlasOrganizationDetails } from "../../organization-contracts";
import { parseSamlIdpMetadata } from "../../saml-metadata-parser";
import type {
  WorkspaceOIDCSetupFormState,
  WorkspaceSAMLSetupFormState,
} from "./organization-page-controller";
import { WorkspaceSSODomainHint } from "./workspace-sso-domain-hint";
import { WorkspaceSSOCopyField } from "./workspace-sso-copy-field";
import { WorkspaceSSOProviderList } from "./workspace-sso-provider-list";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";
import { Textarea } from "@/platform/ui/textarea";

/**
 * Common consumer-mailbox domains.  Atlas can route through SSO with these
 * registered, but a verified-domain check on `gmail.com` (or similar) is
 * almost certainly a workspace-domain misconfiguration; flag it so the admin
 * gets a chance to swap in their company's own DNS-controlled domain.
 */
const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "aol.com",
  "fastmail.com",
  "gmail.com",
  "googlemail.com",
  "hey.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "pm.me",
  "proton.me",
  "protonmail.com",
  "yahoo.com",
  "ymail.com",
]);

const PREFILL_FLASH_DURATION_MS = 1800;

/**
 * Returns true when `domain` is a consumer-mailbox host Atlas should warn
 * the admin about before they wire SSO to it.
 */
function isLikelyFreeEmailDomain(domain: string): boolean {
  const lowered = domain.trim().toLowerCase();
  return lowered.length > 0 && FREE_EMAIL_DOMAINS.has(lowered);
}

/**
 * Ring-flash on prefilled inputs so the operator can spot which fields the
 * metadata-paste shortcut just changed.
 */
function usePrefillFlash(): {
  flashed: ReadonlySet<string>;
  flash: (fields: readonly string[]) => void;
} {
  const [flashed, setFlashed] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (flashed.size === 0) {
      return;
    }
    const handle = window.setTimeout(() => {
      setFlashed(new Set());
    }, PREFILL_FLASH_DURATION_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [flashed]);

  function flash(fields: readonly string[]) {
    setFlashed(new Set(fields));
  }

  return { flashed, flash };
}

function flashClassName(flashed: ReadonlySet<string>, field: string): string {
  return flashed.has(field)
    ? "transition-shadow ring-2 ring-emerald-300 ring-offset-2 ring-offset-surface rounded-2xl"
    : "transition-shadow rounded-2xl";
}

/**
 * Optional XML-paste shortcut that lifts issuer, sign-in URL, and signing
 * certificate out of an IdP metadata document so admins do not have to
 * extract those three fields by hand.  The textarea is collapsed by default
 * inside an Advanced disclosure to keep the form clean for IdPs that only
 * surface those values via copy/paste.
 *
 * @param props - The component props.
 * @param props.onPrefill - Called with the parsed values so the parent form
 *   can apply them to its own state.
 */
function SamlMetadataPasteField(props: {
  onPrefill: (metadata: { certificate: string; entryPoint: string; issuer: string }) => void;
}) {
  const [xml, setXml] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  function applyPaste() {
    const result = parseSamlIdpMetadata(xml);
    if (!result.ok) {
      setStatus({ ok: false, message: result.error });
      return;
    }
    props.onPrefill(result.metadata);
    const filled: string[] = [];
    if (result.metadata.issuer) filled.push("issuer");
    if (result.metadata.entryPoint) filled.push("sign-in URL");
    if (result.metadata.certificate) filled.push("certificate");
    setStatus({
      ok: true,
      message: `Filled ${filled.join(", ") || "no fields"} from the pasted metadata. Review the values before saving.`,
    });
  }

  return (
    <div className="border-outline-variant bg-surface-container-lowest space-y-2 rounded-2xl border p-4">
      <div className="space-y-1">
        <p className="type-label-medium text-on-surface">Paste IdP metadata XML (recommended)</p>
        <p className="type-body-small text-outline">
          Atlas pulls the issuer, sign-in URL, and signing certificate out of the metadata so you
          don't have to copy three fields by hand.
        </p>
      </div>
      <Textarea
        label="IdP metadata XML"
        rows={10}
        autoExpand
        maxRows={32}
        value={xml}
        onChange={setXml}
        placeholder='<EntityDescriptor entityID="..."> ... </EntityDescriptor>'
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={applyPaste} disabled={!xml.trim()}>
          Prefill from metadata
        </Button>
        {status ? (
          <p className={status.ok ? "type-body-small text-outline" : "type-body-small text-error"}>
            {status.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Lightweight check that the pasted X.509 certificate at least has PEM
 * framing.  Atlas does not parse ASN.1 client-side — Better Auth does that
 * post-registration and surfaces the parsed details (subject, expiry, key
 * algorithm) in the provider list — but a quick frame check catches the
 * most common paste mistakes before submit.
 *
 * @param certificate - The candidate certificate text from the SAML form.
 */
function classifyPemCertificate(
  certificate: string,
): { kind: "empty" } | { kind: "ok"; bodyLines: number } | { kind: "invalid"; reason: string } {
  const trimmed = certificate.trim();
  if (!trimmed) {
    return { kind: "empty" };
  }
  const lines = trimmed.split(/\r?\n/);
  const header = lines[0]?.trim() ?? "";
  const footer = lines[lines.length - 1]?.trim() ?? "";
  if (!header.startsWith("-----BEGIN") || !header.endsWith("-----")) {
    return {
      kind: "invalid",
      reason: "Certificate is missing the -----BEGIN CERTIFICATE----- header.",
    };
  }
  if (!footer.startsWith("-----END") || !footer.endsWith("-----")) {
    return {
      kind: "invalid",
      reason: "Certificate is missing the -----END CERTIFICATE----- footer.",
    };
  }
  const bodyLines = lines.slice(1, -1).filter((line) => line.trim().length > 0);
  if (bodyLines.length === 0) {
    return { kind: "invalid", reason: "Certificate body is empty." };
  }
  const body = bodyLines.join("");
  if (!/^[A-Za-z0-9+/=]+$/.test(body)) {
    return {
      kind: "invalid",
      reason: "Certificate body has non-base64 characters.",
    };
  }
  return { kind: "ok", bodyLines: bodyLines.length };
}

/**
 * Returns the candidate SAML issuer's origin when the value parses as a URL,
 * otherwise null.  The allowlist is matched by URL origin so per-tenant query
 * parameters do not need to be enumerated.
 *
 * @param issuer - The candidate SAML issuer URL pasted by the workspace admin.
 */
function extractIssuerOrigin(issuer: string): string | null {
  const trimmed = issuer.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

/**
 * Props for the enterprise SSO management section.
 */
interface WorkspaceSSOSectionProps {
  canManageOrganization: boolean;
  domainVerificationTokens: Record<string, string>;
  isPending: boolean;
  oidcSetupForm: WorkspaceOIDCSetupFormState;
  organization: AtlasOrganizationDetails;
  samlAllowedIssuerOrigins: readonly string[];
  samlSetupForm: WorkspaceSAMLSetupFormState;
  samlVerificationTimedOutProviderIds?: readonly string[];
  setOidcSetupForm: (
    updater: (current: WorkspaceOIDCSetupFormState) => WorkspaceOIDCSetupFormState,
  ) => void;
  setSamlSetupForm: (
    updater: (current: WorkspaceSAMLSetupFormState) => WorkspaceSAMLSetupFormState,
  ) => void;
  onDeleteProvider: (providerId: string) => Promise<void>;
  onOidcSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onRequestDomainVerification: (providerId: string) => Promise<void>;
  onRotateSAMLCertificate: (providerId: string, certificate: string) => Promise<void>;
  onSamlSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onSavePrimaryProvider: (providerId: string | null) => Promise<void>;
  onVerifyDomain: (providerId: string) => Promise<void>;
}

/**
 * Enterprise SSO management surface for team workspaces.
 */
export function WorkspaceSSOSection({
  canManageOrganization,
  domainVerificationTokens,
  isPending,
  oidcSetupForm,
  organization,
  samlAllowedIssuerOrigins,
  samlSetupForm,
  samlVerificationTimedOutProviderIds,
  setOidcSetupForm,
  setSamlSetupForm,
  onDeleteProvider,
  onOidcSubmit,
  onRequestDomainVerification,
  onRotateSAMLCertificate,
  onSamlSubmit,
  onSavePrimaryProvider,
  onVerifyDomain,
}: WorkspaceSSOSectionProps) {
  const { setup } = organization.sso;
  const hasWorkspaceDomainSuggestion = Boolean(setup.workspaceDomainSuggestion);
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
  const oidcDomainTrimmed = oidcSetupForm.domain.trim().toLowerCase();
  const oidcDomainIsFreeEmail = isLikelyFreeEmailDomain(oidcDomainTrimmed);
  const samlPrefill = usePrefillFlash();

  return (
    <section className="space-y-6">
      <article className="border-outline bg-surface space-y-4 rounded-[1.5rem] border p-6">
        <div className="space-y-2">
          <h2 className="type-title-large text-on-surface">Enterprise SSO</h2>
          <p className="type-body-medium text-outline">
            Configure enterprise sign-in for your team. Atlas generates the provider IDs and
            callback URLs to copy directly into Google Workspace or any SAML 2.0 admin console.
          </p>
        </div>
      </article>

      <WorkspaceSSOProviderList
        canManageOrganization={canManageOrganization}
        domainVerificationTokens={domainVerificationTokens}
        isPending={isPending}
        organization={organization}
        verificationTimedOutProviderIds={samlVerificationTimedOutProviderIds ?? []}
        onDeleteProvider={onDeleteProvider}
        onRequestDomainVerification={onRequestDomainVerification}
        onRotateSAMLCertificate={onRotateSAMLCertificate}
        onSavePrimaryProvider={onSavePrimaryProvider}
        onVerifyDomain={onVerifyDomain}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <article className="border-outline bg-surface space-y-5 rounded-[1.5rem] border p-6">
          <div className="space-y-2">
            <h3 className="type-title-large text-on-surface">Google Workspace OIDC</h3>
            <p className="type-body-medium text-outline">
              Use this for teams signing in through Google Workspace.
            </p>
          </div>

          <ol className="type-body-medium text-outline list-decimal space-y-2 pl-5">
            <li>Create or open the Google Cloud OAuth client for this workspace.</li>
            <li>Paste the redirect URI and issuer details shown below into Google.</li>
            <li>Paste the workspace domain, client ID, and client secret into Atlas.</li>
            <li>
              Save the provider, publish the DNS TXT verification record, then verify it here.
            </li>
          </ol>

          <div className="grid gap-3">
            <WorkspaceSSOCopyField label="Google issuer" value={setup.googleWorkspaceIssuer} />
            <WorkspaceSSOCopyField
              label="Requested scopes"
              value={setup.googleWorkspaceScopes.join(" ")}
            />
            <WorkspaceSSOCopyField
              label="Suggested provider ID"
              value={setup.oidcProviderIdSuggestion}
            />
            <WorkspaceSSOCopyField label="Authorized redirect URI" value={setup.oidcRedirectUrl} />
          </div>

          {canManageOrganization ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                void onOidcSubmit(e);
              }}
            >
              <div className="space-y-1">
                <Input
                  label="Workspace domain"
                  value={oidcSetupForm.domain}
                  onChange={(value) => {
                    setOidcSetupForm((current) => ({
                      ...current,
                      domain: value,
                    }));
                  }}
                  placeholder={setup.workspaceDomainSuggestion || "your-org.example"}
                />
                {oidcDomainIsFreeEmail ? (
                  <p className="type-body-small rounded-2xl bg-amber-50 px-3 py-2 text-amber-800">
                    {oidcDomainTrimmed} is a consumer mailbox host. Use the domain your team
                    actually receives email at.
                  </p>
                ) : null}
              </div>
              {hasWorkspaceDomainSuggestion ? (
                <WorkspaceSSODomainHint suggestion={setup.workspaceDomainSuggestion} />
              ) : null}
              <Input
                label="Client ID"
                value={oidcSetupForm.clientId}
                onChange={(value) => {
                  setOidcSetupForm((current) => ({
                    ...current,
                    clientId: value,
                  }));
                }}
              />
              <Input
                label="Client secret"
                type="password"
                value={oidcSetupForm.clientSecret}
                onChange={(value) => {
                  setOidcSetupForm((current) => ({
                    ...current,
                    clientSecret: value,
                  }));
                }}
              />
              <details className="text-outline space-y-2">
                <summary className="type-label-medium cursor-pointer">
                  Advanced: override the suggested provider ID
                </summary>
                <Input
                  label="Provider ID"
                  value={oidcSetupForm.providerId}
                  onChange={(value) => {
                    setOidcSetupForm((current) => ({
                      ...current,
                      providerId: value,
                    }));
                  }}
                  placeholder={setup.oidcProviderIdSuggestion}
                />
                <p className="type-body-small text-outline">
                  Keep the suggested value unless you have a reason to change it. Provider IDs must
                  be unique across Atlas; collisions cause registration to fail.{" "}
                  <a
                    href="https://atlas.rebuildingus.org/docs/deployment/google-workspace-oidc-sso"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline"
                  >
                    Learn more
                  </a>
                  .
                </p>
              </details>
              <Button
                type="submit"
                disabled={
                  isPending ||
                  !oidcSetupForm.clientId.trim() ||
                  !oidcSetupForm.clientSecret.trim() ||
                  !oidcSetupForm.domain.trim() ||
                  !oidcSetupForm.providerId.trim()
                }
              >
                {isPending ? "Saving..." : "Save Google Workspace OIDC"}
              </Button>
            </form>
          ) : (
            <p className="type-body-medium text-outline">
              Only owners and admins can register enterprise providers.
            </p>
          )}
        </article>

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
            <li>
              Save the provider, publish the DNS TXT verification record, then verify it here.
            </li>
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
                    setSamlSetupForm((current) => ({
                      ...current,
                      domain: value,
                    }));
                  }}
                  placeholder={setup.workspaceDomainSuggestion || "your-org.example"}
                />
                {samlDomainIsFreeEmail ? (
                  <p className="type-body-small rounded-2xl bg-amber-50 px-3 py-2 text-amber-800">
                    {samlDomainTrimmed} is a consumer mailbox host. Use the domain your team
                    actually receives email at — for example <code>acme.com</code>, not{" "}
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
                      setSamlSetupForm((current) => ({
                        ...current,
                        issuer: value,
                      }));
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
                    setSamlSetupForm((current) => ({
                      ...current,
                      entryPoint: value,
                    }));
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
                      setSamlSetupForm((current) => ({
                        ...current,
                        certificate: value,
                      }));
                    }}
                    placeholder="-----BEGIN CERTIFICATE-----"
                  />
                </div>
                {samlCertificateClassification.kind === "invalid" ? (
                  <p className="type-body-small text-error">
                    {samlCertificateClassification.reason} Atlas parses the certificate server-side
                    after save and shows the parsed expiry and fingerprint here.
                  </p>
                ) : samlCertificateClassification.kind === "ok" ? (
                  <p className="type-body-small text-outline">
                    Looks like a PEM certificate ({samlCertificateClassification.bodyLines} body
                    line{samlCertificateClassification.bodyLines === 1 ? "" : "s"}). Atlas will
                    parse and display the expiry and fingerprint after save.
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
                    setSamlSetupForm((current) => ({
                      ...current,
                      providerId: value,
                    }));
                  }}
                  placeholder={setup.samlProviderIdSuggestion}
                />
                <p className="type-body-small text-outline">
                  Keep the suggested value unless you have a reason to change it. Provider IDs must
                  be unique across Atlas; collisions cause registration to fail.{" "}
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
              {samlSetupForm.domain.trim() &&
              samlSetupForm.issuer.trim() &&
              samlSetupForm.entryPoint.trim() &&
              samlCertificateLooksValid &&
              samlIssuerAllowed ? (
                <div className="border-outline-variant bg-surface-container-lowest rounded-2xl border px-4 py-3">
                  <p className="type-label-medium text-on-surface mb-1">Atlas will save:</p>
                  <ul className="type-body-small text-outline space-y-0.5">
                    <li>Domain: {samlSetupForm.domain.trim()}</li>
                    <li>Issuer: {samlSetupForm.issuer.trim()}</li>
                    <li>Sign-in URL: {samlSetupForm.entryPoint.trim()}</li>
                    <li>
                      Provider ID:{" "}
                      {samlSetupForm.providerId.trim() || setup.samlProviderIdSuggestion}
                    </li>
                  </ul>
                </div>
              ) : null}
              <p className="type-body-small text-outline">
                Need to verify multiple domains for the same SAML IdP? Configure one provider per
                domain or{" "}
                <a
                  href="mailto:hello@rebuildingus.org?subject=Atlas%20SAML%20multi-domain"
                  className="underline"
                >
                  email Atlas operators
                </a>{" "}
                to enable multi-domain on this provider.
              </p>
              <Button
                type="submit"
                disabled={
                  isPending ||
                  !samlCertificateLooksValid ||
                  !samlSetupForm.domain.trim() ||
                  !samlSetupForm.entryPoint.trim() ||
                  !samlSetupForm.issuer.trim() ||
                  !samlSetupForm.providerId.trim() ||
                  !samlIssuerAllowed
                }
              >
                {isPending ? "Saving..." : "Save SAML provider"}
              </Button>
            </form>
          ) : (
            <p className="type-body-medium text-outline">
              Only owners and admins can register enterprise providers.
            </p>
          )}
        </article>
      </div>
    </section>
  );
}
