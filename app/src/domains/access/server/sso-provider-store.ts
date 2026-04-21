import "@tanstack/react-start/server-only";

import { getAuthRuntimeConfig } from "./runtime";
import { getAuthDatabase, getAuthPgPool } from "./auth";
import {
  buildWorkspaceSamlMetadataUrl,
  rawWorkspaceSSOProviderSchema,
  toAtlasWorkspaceSSOProvider,
} from "../organization-sso";
import { normalizeAtlasOrganizationMetadata } from "../organization-metadata";

interface StoredWorkspaceRow {
  id: string;
  metadata: string | null;
  name: string;
  slug: string;
}

interface StoredWorkspaceSSOProviderRow {
  domain: string;
  domainVerified: number | null;
  issuer: string;
  oidcConfig: string | null;
  organizationId: string | null;
  providerId: string;
  samlConfig: string | null;
}

/**
 * Public workspace summary Atlas uses while resolving enterprise sign-in before
 * a browser session exists.
 */
export interface StoredWorkspaceIdentity {
  id: string;
  name: string;
  primaryProviderId: string | null;
  slug: string;
}

/**
 * Redacted SSO provider record Atlas reads from Better Auth's internal
 * store when the public sign-in page needs provider routing hints.
 */
export interface StoredWorkspaceSSOProvider {
  domain: string;
  domainVerified: boolean;
  hasOIDC: boolean;
  hasSAML: boolean;
  issuer: string;
  organizationId: string | null;
  providerId: string;
  spMetadataUrl: string;
}

/**
 * Parses one JSON field persisted by Better Auth.
 *
 * @param value - The raw JSON string stored in the database.
 */
function parseStoredJson(value: string | null): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Loads one workspace row directly from Better Auth's organization table.
 *
 * @param organizationId - The Better Auth organization identifier.
 */
export async function loadStoredWorkspaceIdentity(
  organizationId: string,
): Promise<StoredWorkspaceIdentity | null> {
  const pool = getAuthPgPool();
  let workspace: StoredWorkspaceRow | undefined;

  if (pool) {
    const result = await pool.query(
      "select id, metadata, name, slug from organization where id = $1 limit 1",
      [organizationId],
    );
    workspace = result.rows[0] as StoredWorkspaceRow | undefined;
  } else {
    const database = getAuthDatabase();
    if (!database) throw new Error("No database configured for SSO provider lookup");
    const statement = database.prepare(
      "select id, metadata, name, slug from organization where id = ? limit 1",
    );
    workspace = statement.get(organizationId) as StoredWorkspaceRow | undefined;
  }

  if (!workspace) {
    return null;
  }

  const metadata = normalizeAtlasOrganizationMetadata(parseStoredJson(workspace.metadata));

  return {
    id: workspace.id,
    name: workspace.name,
    primaryProviderId: metadata.ssoPrimaryProviderId,
    slug: workspace.slug,
  };
}

/**
 * Lists the persisted SSO providers Atlas can inspect before an authenticated
 * Better Auth session exists.
 */
export async function listStoredWorkspaceSSOProviders(): Promise<StoredWorkspaceSSOProvider[]> {
  const pool = getAuthPgPool();
  let providerRows: StoredWorkspaceSSOProviderRow[];

  if (pool) {
    const result = await pool.query(
      'select "providerId", issuer, domain, "organizationId", "domainVerified", "oidcConfig", "samlConfig" from "ssoProvider"',
    );
    providerRows = result.rows as StoredWorkspaceSSOProviderRow[];
  } else {
    const database = getAuthDatabase();
    if (!database) throw new Error("No database configured for SSO provider listing");
    const statement = database.prepare(
      "select providerId, issuer, domain, organizationId, domainVerified, oidcConfig, samlConfig from ssoProvider",
    );
    providerRows = statement.all() as StoredWorkspaceSSOProviderRow[];
  }

  const runtime = getAuthRuntimeConfig();
  const providers: StoredWorkspaceSSOProvider[] = [];

  for (const providerRow of providerRows) {
    const oidcConfig = parseStoredJson(providerRow.oidcConfig);
    const samlConfig = parseStoredJson(providerRow.samlConfig);
    const rawProvider = rawWorkspaceSSOProviderSchema.parse({
      domain: providerRow.domain,
      domainVerified: Boolean(providerRow.domainVerified),
      issuer: providerRow.issuer,
      oidcConfig: oidcConfig ?? undefined,
      organizationId: providerRow.organizationId,
      providerId: providerRow.providerId,
      samlConfig: samlConfig ?? undefined,
      spMetadataUrl: buildWorkspaceSamlMetadataUrl(runtime.publicBaseUrl, providerRow.providerId),
      type: samlConfig ? "saml" : "oidc",
    });
    const provider = toAtlasWorkspaceSSOProvider(rawProvider, null);

    providers.push({
      domain: provider.domain,
      domainVerified: provider.domainVerified,
      hasOIDC: provider.oidc !== null,
      hasSAML: provider.saml !== null,
      issuer: provider.issuer,
      organizationId: provider.organizationId,
      providerId: provider.providerId,
      spMetadataUrl: provider.spMetadataUrl,
    });
  }

  return providers;
}
