import "@tanstack/react-start/server-only";

import { timingSafeEqual } from "node:crypto";
import { normalizeAtlasOrganizationMetadata } from "../organization-metadata";
import { getAuthDatabase, getAuthPgPool } from "./auth";
import { getAuthRuntimeConfig } from "./runtime";
import { queryActiveProducts } from "./workspace-products";

/**
 * Response shape returned by the internal membership verification endpoint
 * when the user is confirmed as a member of the organization.
 */
interface MembershipVerificationResponse {
  activeProducts: string[];
  name: string;
  role: string;
  slug: string;
  verifiedSsoDomains: string[];
  workspaceDomain: string | null;
  workspaceType: "individual" | "team";
}

interface StoredMembershipVerificationRow {
  metadata: unknown;
  name: string;
  role: string;
  slug: string;
}

interface StoredVerifiedSsoProviderRow {
  domain: string;
  domainVerified?: boolean | number | null;
  organizationId?: string | null;
}

function parseStoredMetadata(metadata: unknown): unknown {
  if (typeof metadata !== "string") {
    return metadata;
  }

  try {
    return JSON.parse(metadata) as unknown;
  } catch {
    return {};
  }
}

async function queryStoredMembership(
  organizationId: string,
  userId: string,
): Promise<StoredMembershipVerificationRow | null> {
  const pgPool = getAuthPgPool();
  if (pgPool) {
    const result = await pgPool.query<StoredMembershipVerificationRow>(
      `
        SELECT organization.name, organization.slug, organization.metadata, member.role
        FROM "member"
        INNER JOIN organization ON organization.id = member."organizationId"
        WHERE member."organizationId" = $1 AND member."userId" = $2
        LIMIT 1
      `,
      [organizationId, userId],
    );
    return result.rows[0] ?? null;
  }

  const database = getAuthDatabase();
  const row = database
    ?.prepare(
      `
        SELECT organization.name, organization.slug, organization.metadata, member.role
        FROM member
        INNER JOIN organization ON organization.id = member.organizationId
        WHERE member.organizationId = ? AND member.userId = ?
        LIMIT 1
      `,
    )
    .get(organizationId, userId) as StoredMembershipVerificationRow | undefined;

  return row ?? null;
}

function normalizeProviderDomains(domainValue: string): string[] {
  return domainValue
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

async function queryVerifiedSsoDomains(organizationId: string): Promise<string[]> {
  const pgPool = getAuthPgPool();
  let rows: StoredVerifiedSsoProviderRow[];
  if (pgPool) {
    const result = await pgPool.query<StoredVerifiedSsoProviderRow>(
      `
        SELECT domain
        FROM "ssoProvider"
        WHERE "organizationId" = $1 AND "domainVerified" = true
      `,
      [organizationId],
    );
    rows = result.rows;
  } else {
    const database = getAuthDatabase();
    const statement = database?.prepare(
      `
        SELECT domain, domainVerified, organizationId
        FROM ssoProvider
        WHERE organizationId = ? AND domainVerified = 1
      `,
    );
    if (!statement || typeof statement.all !== "function") {
      return [];
    }
    rows = statement.all(organizationId) as StoredVerifiedSsoProviderRow[];
  }

  const verifiedRows = rows.filter((row) => {
    const matchesOrganization =
      row.organizationId === undefined ||
      row.organizationId === null ||
      row.organizationId === organizationId;
    const verified =
      row.domainVerified === undefined || row.domainVerified === true || row.domainVerified === 1;
    return matchesOrganization && verified;
  });
  return Array.from(
    new Set(verifiedRows.flatMap((row) => normalizeProviderDomains(row.domain))),
  ).sort();
}

/**
 * Private app-to-API membership verification endpoint.
 *
 * The Python API service calls this to confirm whether a user belongs to a
 * given organization and, if so, retrieve the member's role and workspace
 * metadata.
 */
export async function verifyMembershipRequest(
  request: Request,
  organizationId: string,
  userId: string,
): Promise<Response> {
  const runtime = getAuthRuntimeConfig();
  const providedSecret = request.headers.get("x-atlas-internal-secret");
  const secretMatches =
    !!runtime.internalSecret &&
    !!providedSecret &&
    runtime.internalSecret.length === providedSecret.length &&
    timingSafeEqual(Buffer.from(runtime.internalSecret), Buffer.from(providedSecret));

  if (!secretMatches) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const storedMembership = await queryStoredMembership(organizationId, userId);
  if (!storedMembership) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const metadata = normalizeAtlasOrganizationMetadata(
    parseStoredMetadata(storedMembership.metadata),
  );
  const activeProducts = await queryActiveProducts(organizationId);
  const verifiedSsoDomains = await queryVerifiedSsoDomains(organizationId);

  const body: MembershipVerificationResponse = {
    activeProducts,
    name: storedMembership.name,
    role: storedMembership.role,
    slug: storedMembership.slug,
    verifiedSsoDomains,
    workspaceDomain: metadata.workspaceDomain ?? null,
    workspaceType: metadata.workspaceType,
  };

  return Response.json(body, { status: 200 });
}
