export interface AtlasApiAudienceInput {
  apiBaseUrl: string | null | undefined;
  publicBaseUrl: string;
}

export function buildMcpResourceUrl(publicBaseUrl: string): string {
  return new URL("/mcp", publicBaseUrl).toString().replace(/\/$/, "");
}

export function buildAtlasApiAudience({
  apiBaseUrl,
  publicBaseUrl,
}: AtlasApiAudienceInput): string {
  const audiences = [buildMcpResourceUrl(publicBaseUrl)];
  const apiOrigin = apiBaseUrl ? new URL(apiBaseUrl).origin : null;

  if (apiOrigin) {
    audiences.push(apiOrigin);
  }

  return audiences.join(",");
}
