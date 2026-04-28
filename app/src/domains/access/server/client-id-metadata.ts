import "@tanstack/react-start/server-only";

/**
 * Implements OAuth Client ID Metadata Documents (CIMD) support per the IETF
 * draft `draft-ietf-oauth-client-id-metadata-document-00` and the MCP
 * authorization spec §"Client ID Metadata Documents".
 *
 * Atlas keeps Better Auth's anonymous-DCR phishing guard
 * (`allowUnauthenticatedClientRegistration: false`) and instead lets MCP
 * clients identify by an HTTPS URL whose body is a JSON metadata document.
 * When a URL-shaped `client_id` appears at `/oauth2/authorize`, this resolver
 * fetches the document, validates it, and the caller materializes a
 * Better Auth `oauthClient` row from it.
 */

/**
 * Validated subset of the CIMD JSON document Atlas accepts.
 *
 * Optional fields beyond `client_id`, `client_name`, and `redirect_uris` are
 * preserved when present so they can be surfaced on the consent page.
 */
export interface ClientIdMetadataDocument {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  client_uri?: string;
  logo_uri?: string;
  contacts?: string[];
  policy_uri?: string;
  tos_uri?: string;
  software_id?: string;
  software_version?: string;
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
}

/**
 * Configuration the resolver pulls from runtime env so deployments can opt
 * into a stricter trust policy than the spec's default of "any HTTPS URL".
 */
export interface ClientIdMetadataResolverOptions {
  /**
   * Optional allowlist of host suffixes (case-insensitive).  When non-empty,
   * the document URL's host must end with one of these suffixes.  Empty (the
   * default) means "any HTTPS URL is acceptable", which matches the spec's
   * "open server" trust policy.
   */
  allowedHostSuffixes: readonly string[];
  /**
   * Maximum bytes to read from the metadata document.  10 KiB is well above
   * the size of a realistic CIMD document; anything larger is treated as a
   * resource-exhaustion attempt.
   */
  maxBytes: number;
  /**
   * Hard timeout for the network fetch.
   */
  timeoutMs: number;
}

/**
 * Default resolver options used when callers don't override them.
 */
export const DEFAULT_CIMD_RESOLVER_OPTIONS: ClientIdMetadataResolverOptions = {
  allowedHostSuffixes: [],
  maxBytes: 10 * 1024,
  timeoutMs: 5_000,
};

/**
 * Discriminated error thrown when CIMD resolution fails so callers can map
 * each failure mode to the correct OAuth error response.
 */
export class ClientIdMetadataError extends Error {
  readonly code:
    | "invalid_url"
    | "untrusted_host"
    | "fetch_failed"
    | "invalid_document"
    | "client_id_mismatch";

  constructor(
    code:
      | "invalid_url"
      | "untrusted_host"
      | "fetch_failed"
      | "invalid_document"
      | "client_id_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "ClientIdMetadataError";
    this.code = code;
  }
}

/**
 * Returns true when `value` looks like a CIMD-shaped `client_id` per the spec
 * (HTTPS URL with a non-empty path component).  Anything else — opaque
 * Better Auth client IDs, malformed URLs, plain `https://example.com` with no
 * path — falls through to the conventional client lookup path.
 */
export function isClientIdMetadataDocumentUrl(value: string): boolean {
  if (!value.startsWith("https://")) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  if (parsed.hash) {
    return false;
  }
  if (parsed.pathname === "/" || parsed.pathname === "") {
    return false;
  }
  return true;
}

const PRIVATE_HOST_PATTERNS: readonly RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/,
  /^\[::1\]$/,
];

function isPrivateHost(hostname: string): boolean {
  for (const pattern of PRIVATE_HOST_PATTERNS) {
    if (pattern.test(hostname)) {
      return true;
    }
  }
  return false;
}

function ensureAllowedHost(url: URL, allowedHostSuffixes: readonly string[]): void {
  if (isPrivateHost(url.hostname)) {
    throw new ClientIdMetadataError(
      "untrusted_host",
      `Refusing to fetch CIMD document from non-public host ${url.hostname}.`,
    );
  }

  if (allowedHostSuffixes.length === 0) {
    return;
  }

  const lowered = url.hostname.toLowerCase();
  for (const suffix of allowedHostSuffixes) {
    const normalized = suffix.trim().toLowerCase();
    if (!normalized) continue;
    if (lowered === normalized || lowered.endsWith(`.${normalized}`)) {
      return;
    }
  }
  throw new ClientIdMetadataError(
    "untrusted_host",
    `CIMD host ${url.hostname} is not in the configured allowlist.`,
  );
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) {
      return undefined;
    }
    result.push(entry);
  }
  return result;
}

/**
 * Validates a JSON payload as a CIMD document.  Throws when required fields
 * are missing, the `client_id` does not match the document URL exactly, or
 * the `redirect_uris` list contains an invalid URL.
 *
 * @param raw - The decoded JSON value.
 * @param documentUrl - The HTTPS URL the document was fetched from; serves as
 *   the canonical `client_id` per draft §3.
 */
export function validateClientIdMetadataDocument(
  raw: unknown,
  documentUrl: string,
): ClientIdMetadataDocument {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ClientIdMetadataError("invalid_document", "CIMD response was not a JSON object.");
  }

  const record = raw as Record<string, unknown>;
  const clientId = asString(record.client_id);
  if (!clientId) {
    throw new ClientIdMetadataError(
      "invalid_document",
      "CIMD document is missing the required `client_id` field.",
    );
  }
  if (clientId !== documentUrl) {
    throw new ClientIdMetadataError(
      "client_id_mismatch",
      "CIMD document `client_id` does not match the URL it was fetched from.",
    );
  }

  const clientName = asString(record.client_name);
  if (!clientName) {
    throw new ClientIdMetadataError(
      "invalid_document",
      "CIMD document is missing the required `client_name` field.",
    );
  }

  const redirectUris = asStringArray(record.redirect_uris);
  if (!redirectUris || redirectUris.length === 0) {
    throw new ClientIdMetadataError(
      "invalid_document",
      "CIMD document is missing the required `redirect_uris` array.",
    );
  }
  for (const uri of redirectUris) {
    try {
      const parsed = new URL(uri);
      const isLoopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) {
        throw new ClientIdMetadataError(
          "invalid_document",
          `CIMD redirect_uri ${uri} must be HTTPS or an http://localhost loopback.`,
        );
      }
    } catch (error) {
      if (error instanceof ClientIdMetadataError) {
        throw error;
      }
      throw new ClientIdMetadataError(
        "invalid_document",
        `CIMD redirect_uri ${uri} is not a valid URL.`,
      );
    }
  }

  const tokenEndpointAuthMethod = asString(record.token_endpoint_auth_method);
  if (tokenEndpointAuthMethod && tokenEndpointAuthMethod !== "none") {
    throw new ClientIdMetadataError(
      "invalid_document",
      'Atlas only accepts CIMD documents with `token_endpoint_auth_method: "none"`.',
    );
  }

  return {
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    client_uri: asString(record.client_uri),
    logo_uri: asString(record.logo_uri),
    contacts: asStringArray(record.contacts),
    policy_uri: asString(record.policy_uri),
    tos_uri: asString(record.tos_uri),
    software_id: asString(record.software_id),
    software_version: asString(record.software_version),
    grant_types: asStringArray(record.grant_types),
    response_types: asStringArray(record.response_types),
    token_endpoint_auth_method: tokenEndpointAuthMethod,
  };
}

/**
 * Reads the response body, capped at `maxBytes`.  Throws when the body
 * exceeds the cap so a hostile server cannot exhaust the resolver.
 */
async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new ClientIdMetadataError("fetch_failed", "CIMD response had no body.");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => {
        /* swallow cancel errors; the size violation is the real failure */
      });
      throw new ClientIdMetadataError(
        "fetch_failed",
        `CIMD document exceeded ${maxBytes}-byte size cap.`,
      );
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  try {
    return JSON.parse(decoded);
  } catch {
    throw new ClientIdMetadataError("invalid_document", "CIMD document was not valid JSON.");
  }
}

/**
 * Fetches and validates a Client ID Metadata Document.  Caller is
 * responsible for materializing the resulting record into Better Auth's
 * `oauthClient` table.
 *
 * @param clientIdUrl - The URL used as the OAuth `client_id`.
 * @param options - Resolver options (host allowlist, size/timeout caps).
 * @param fetchImpl - Optional fetch override.  Tests pass a stub here.
 */
export async function resolveClientIdMetadataDocument(
  clientIdUrl: string,
  options: ClientIdMetadataResolverOptions = DEFAULT_CIMD_RESOLVER_OPTIONS,
  fetchImpl: typeof fetch = fetch,
): Promise<ClientIdMetadataDocument> {
  let parsed: URL;
  try {
    parsed = new URL(clientIdUrl);
  } catch {
    throw new ClientIdMetadataError("invalid_url", "CIMD client_id is not a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new ClientIdMetadataError("invalid_url", "CIMD client_id must use the https scheme.");
  }
  if (parsed.hash) {
    throw new ClientIdMetadataError("invalid_url", "CIMD client_id must not contain a fragment.");
  }

  ensureAllowedHost(parsed, options.allowedHostSuffixes);

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(clientIdUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
  } catch (error) {
    throw new ClientIdMetadataError(
      "fetch_failed",
      `CIMD fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new ClientIdMetadataError("fetch_failed", `CIMD fetch returned HTTP ${response.status}.`);
  }

  const body = await readBoundedJson(response, options.maxBytes);
  return validateClientIdMetadataDocument(body, clientIdUrl);
}
