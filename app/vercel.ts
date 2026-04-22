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

  const normalizedCandidate = /^https?:\/\//.test(candidate)
    ? candidate
    : `https://${candidate}`;

  try {
    return new URL(normalizedCandidate).origin;
  } catch {
    return undefined;
  }
}

const docsOrigin = normalizeOrigin(process.env.ATLAS_DOCS_URL);

/**
 * Proxy rewrites — only included when the corresponding env var is configured.
 * Both the bare path (/docs) and the wildcard (/docs/*) are rewritten so that
 * redirects within the docs site continue to resolve under the Atlas domain.
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
];

/**
 * Security headers shared by every route. Applied first; the docs-specific
 * rule below overrides the CSP for /docs paths.
 */
const BASE_HEADERS = [
  // Prevent MIME-type sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Disallow framing entirely (clickjacking protection)
  { key: "X-Frame-Options", value: "DENY" },
  // Legacy XSS filter for older browsers
  { key: "X-XSS-Protection", value: "1; mode=block" },
  // Limit referrer to origin only on cross-origin requests
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Deny access to sensitive browser APIs not needed by this app
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Enforce HTTPS for 2 years, including subdomains; eligible for preload list
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

/**
 * Strict CSP for the Atlas app. 'unsafe-inline' is required for the TanStack
 * Start hydration scripts injected at runtime.
 */
const APP_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com; connect-src 'self' https://vitals.vercel-insights.com https://va.vercel-scripts.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/**
 * Permissive CSP for the proxied Mintlify docs. Mintlify loads Google Fonts
 * and uses eval-based rendering, so those must be allowed for /docs routes.
 * All other directives remain restrictive.
 */
const DOCS_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

export const config = {
  headers: [
    // Base headers + strict CSP for all app routes
    {
      source: "/(.*)",
      headers: [...BASE_HEADERS, { key: "Content-Security-Policy", value: APP_CSP }],
    },
    // Override CSP for the proxied Mintlify docs (bare /docs path)
    {
      source: "/docs",
      headers: [{ key: "Content-Security-Policy", value: DOCS_CSP }],
    },
    // Override CSP for all nested /docs/* paths
    {
      source: "/docs/:path*",
      headers: [{ key: "Content-Security-Policy", value: DOCS_CSP }],
    },
  ],
  ...(rewrites.length > 0 ? { rewrites } : {}),
};
