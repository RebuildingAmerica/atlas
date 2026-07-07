export interface HostedAtlasEnv {
  ATLAS_AUTH_JWT_AUDIENCES?: string;
  ATLAS_DEPLOY_MODE?: string;
  ATLAS_PUBLIC_URL?: string;
  ATLAS_SERVER_API_PROXY_TARGET?: string;
  VERCEL_ENV?: string;
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function requiredValue(env: HostedAtlasEnv, key: keyof HostedAtlasEnv, context: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required for ${context}.`);
  }
  return value;
}

function parseUrl(value: string, label: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
}

export function buildMcpResourceUrl(origin: string): string {
  const url = new URL("/mcp", origin);
  return url.toString().replace(/\/$/, "");
}

export function buildHostedRewriteDestination(origin: string, pathname: string): string {
  const baseOrigin = normalizeUrlLikeOrigin(origin, "rewrite origin").origin;
  const url = new URL(pathname, `${baseOrigin}/`);
  return url.toString();
}

function normalizeUrlLikeOrigin(value: string, label: string): URL {
  const normalized = /^https?:\/\//.test(value) ? value : `https://${value}`;
  return parseUrl(normalized, label);
}

function audienceValues(env: HostedAtlasEnv, context: string): string[] {
  return requiredValue(env, "ATLAS_AUTH_JWT_AUDIENCES", context)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isHostedAtlasEnv(env: HostedAtlasEnv): boolean {
  return (
    env.ATLAS_DEPLOY_MODE === "production" ||
    env.ATLAS_DEPLOY_MODE === "staging" ||
    env.VERCEL_ENV === "production"
  );
}

export function normalizeDocsOrigin(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate) {
    return undefined;
  }
  return normalizeUrlLikeOrigin(candidate, "ATLAS_DOCS_URL").origin;
}

export function normalizeApiProxyOrigin(env: HostedAtlasEnv): string | undefined {
  const candidate = env.ATLAS_SERVER_API_PROXY_TARGET?.trim();
  if (!candidate) {
    if (isHostedAtlasEnv(env)) {
      throw new Error("ATLAS_SERVER_API_PROXY_TARGET is required for hosted Atlas deployments.");
    }
    return undefined;
  }

  const url = normalizeUrlLikeOrigin(candidate, "ATLAS_SERVER_API_PROXY_TARGET");
  if (url.protocol === "http:" && !isLocalHost(url.hostname)) {
    throw new Error("ATLAS_SERVER_API_PROXY_TARGET must use https outside local development.");
  }
  return url.origin;
}

export function validateHostedAtlasEnv(env: HostedAtlasEnv): void {
  if (!isHostedAtlasEnv(env)) {
    return;
  }

  const context = "hosted Atlas deployments";
  const publicUrl = parseUrl(requiredValue(env, "ATLAS_PUBLIC_URL", context), "ATLAS_PUBLIC_URL");
  if (publicUrl.protocol !== "https:" && !isLocalHost(publicUrl.hostname)) {
    throw new Error("ATLAS_PUBLIC_URL must use https in hosted Atlas deployments.");
  }

  const proxyUrl = parseUrl(
    requiredValue(env, "ATLAS_SERVER_API_PROXY_TARGET", context),
    "ATLAS_SERVER_API_PROXY_TARGET",
  );
  if (proxyUrl.protocol !== "https:" && !isLocalHost(proxyUrl.hostname)) {
    throw new Error("ATLAS_SERVER_API_PROXY_TARGET must use https in hosted Atlas deployments.");
  }

  const [firstAudience] = audienceValues(env, context);
  const expectedMcpAudience = buildMcpResourceUrl(publicUrl.origin);
  if (firstAudience !== expectedMcpAudience) {
    throw new Error(
      `ATLAS_AUTH_JWT_AUDIENCES must put the canonical MCP resource first: ${expectedMcpAudience}`,
    );
  }
}
