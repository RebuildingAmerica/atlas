/**
 * Vercel deployment configuration for the Atlas app.
 *
 * Exported as `config` and picked up automatically by the Vercel build. Controls:
 *   - Security response headers applied to every route
 *   - Proxy rewrites that forward specific paths to external origins
 *
 * Environment variables:
 *   ATLAS_DOCS_URL — Origin of the hosted Mintlify docs site (e.g. https://atlas.mintlify.app).
 *                    When set, /docs and /docs/* are transparently proxied to that origin so the
 *                    docs appear under the primary Atlas domain at /docs.
 *                    When unset, no rewrite is registered and the /docs route falls through to the
 *                    app's own handler.
 *
 *   ATLAS_SERVER_API_PROXY_TARGET — Origin of the Atlas API service (Cloud Run).  When set,
 *                    /mcp and /mcp/* are rewritten directly to the API origin so the remote
 *                    MCP Streamable HTTP transport bypasses the Nitro app entirely.  This is
 *                    intentional: MCP traffic authenticates with OAuth bearer tokens, not
 *                    browser sessions, so there is no value in routing it through the
 *                    session-aware Nitro proxy.
 */

/**
 * Normalizes an arbitrary string into a bare origin (scheme + host + optional port).
 * Accepts values with or without a scheme — bare hostnames are assumed to be HTTPS.
 * Returns undefined for empty, missing, or malformed values so callers can safely
 * use optional-chaining to gate on the result.
 */
function normalizeOrigin(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate) {
    return undefined;
  }

  const normalizedCandidate = /^https?:\/\//.test(candidate) ? candidate : `https://${candidate}`;

  try {
    return new URL(normalizedCandidate).origin;
  } catch {
    return undefined;
  }
}

const docsOrigin = normalizeOrigin(process.env.ATLAS_DOCS_URL);
const apiOrigin = normalizeOrigin(process.env.ATLAS_SERVER_API_PROXY_TARGET);

/**
 * Proxy rewrites — only included when the corresponding env var is configured.
 * Both the bare path and the wildcard are rewritten so redirects and nested
 * paths within the upstream origin continue to resolve under the Atlas domain.
 */
const rewrites = [
  ...(docsOrigin
    ? [
        {
          source: "/docs",
          destination: `${docsOrigin}/docs`,
        },
        {
          source: "/docs/:match*",
          destination: `${docsOrigin}/docs/:match*`,
        },
      ]
    : []),
  ...(apiOrigin
    ? [
        {
          source: "/mcp",
          destination: `${apiOrigin}/mcp`,
        },
        {
          source: "/mcp/:match*",
          destination: `${apiOrigin}/mcp/:match*`,
        },
      ]
    : []),
];

export const config = {
  headers: [
    // Strict security headers + CSP for all app routes.
    // 'unsafe-inline' in script-src is required for TanStack Start hydration.
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-XSS-Protection", value: "1; mode=block" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        {
          key: "Content-Security-Policy",
          value:
            "default-src 'self'; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com; connect-src 'self' https://vitals.vercel-insights.com https://va.vercel-scripts.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        },
      ],
    },
    // Mintlify-compatible CSP for the proxied docs (bare /docs path).
    // Mintlify requires Google Fonts and eval-based rendering.
    {
      source: "/docs",
      headers: [
        {
          key: "Content-Security-Policy",
          value:
            "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        },
      ],
    },
    // Same Mintlify-compatible CSP for all nested /docs/* paths.
    {
      source: "/docs/:path*",
      headers: [
        {
          key: "Content-Security-Policy",
          value:
            "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        },
      ],
    },
  ],
  ...(rewrites.length > 0 ? { rewrites } : {}),
};
