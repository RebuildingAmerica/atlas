import type { AtlasRoutePath, ExcludedRoute, ScreenshotRoute } from "./manifest-types";

/**
 * Slugs and ids seeded by `atlas.seed_demo`. Keeping them in one place makes the coupling
 * between the Python seed and this manifest obvious when either side changes.
 */
export const SEEDED = {
  campaignSlug: "phoenix-wage-theft-recovery-campaign",
  claimToken: "atlas-demo-claim-token-6b41f0d29c7e",
  claimTokenSlug: "brooklyn-tenant-power-network",
  directoryOrgId: "atlas-demo-directory",
  eventSlug: "milwaukee-voter-access-summit",
  initiativeSlug: "detroit-right-to-counsel-initiative",
  managedOrgSlug: "great-lakes-civic-lab",
  orgSlug: "eastside-housing-network",
  personSlug: "maya-thompson",
  places: {
    borough: "brooklyn-ny",
    city: "detroit-mi",
    county: "wayne-county-mi",
    district: "city-council-district-5-mi",
    metro: "detroit-warren-dearborn-mi",
    neighborhood: "east-english-village-mi",
    polity: "detroit-mi",
  },
} as const;

export const SCREENSHOT_ROUTES = [
  // ---------------------------------------------------------------- public
  { name: "home", routeId: "/", path: "/", mode: "local" },
  { name: "browse", routeId: "/browse", path: "/browse", mode: "local" },
  {
    name: "map",
    routeId: "/map",
    path: "/map",
    mode: "local",
    frame: "viewport",
    wait: { kind: "map" },
    note: "Basemap tiles are stubbed so the capture is offline-stable; set ATLAS_SCREENSHOTS_LIVE_TILES=1 for the real basemap.",
  },
  {
    name: "firehose",
    routeId: "/firehose",
    path: "/firehose",
    mode: "local",
    note: "The live-signal WebSocket does not upgrade through the audit's API proxy, so the feed renders from its initial snapshot rather than streaming.",
  },
  { name: "privacy", routeId: "/privacy", path: "/privacy", mode: "local" },
  { name: "terms", routeId: "/terms", path: "/terms", mode: "local" },
  { name: "security", routeId: "/security", path: "/security", mode: "local" },
  {
    name: "request-discount",
    routeId: "/request-discount",
    path: "/request-discount",
    mode: "local",
  },
  {
    name: "post-logout",
    routeId: "/post-logout",
    path: "/post-logout",
    mode: "local",
    wait: { kind: "selector", selector: "main" },
  },
  { name: "profiles-index", routeId: "/profiles/", path: "/profiles", mode: "local" },
  {
    name: "profiles-organizations",
    routeId: "/profiles/organizations/",
    path: "/profiles/organizations",
    mode: "local",
  },
  {
    name: "profiles-people",
    routeId: "/profiles/people/",
    path: "/profiles/people",
    mode: "local",
  },
  {
    name: "profile-person",
    routeId: "/profiles/people/$slug",
    path: `/profiles/people/${SEEDED.personSlug}`,
    mode: "local",
  },
  {
    name: "profile-organization",
    routeId: "/profiles/organizations/$slug",
    path: `/profiles/organizations/${SEEDED.orgSlug}`,
    mode: "local",
  },
  {
    name: "profile-campaign",
    routeId: "/profiles/campaigns/$slug",
    path: `/profiles/campaigns/${SEEDED.campaignSlug}`,
    mode: "local",
  },
  {
    name: "profile-event",
    routeId: "/profiles/events/$slug",
    path: `/profiles/events/${SEEDED.eventSlug}`,
    mode: "local",
  },
  {
    name: "profile-initiative",
    routeId: "/profiles/initiatives/$slug",
    path: `/profiles/initiatives/${SEEDED.initiativeSlug}`,
    mode: "local",
  },
  {
    name: "place-auto",
    routeId: "/places/$placeSlug",
    path: `/places/${SEEDED.places.polity}`,
    mode: "local",
  },
  {
    name: "place-polity",
    routeId: "/places/polities/$placeSlug",
    path: `/places/polities/${SEEDED.places.polity}`,
    mode: "local",
  },
  {
    name: "place-city",
    routeId: "/places/cities/$placeSlug",
    path: `/places/cities/${SEEDED.places.city}`,
    mode: "local",
  },
  {
    name: "place-county",
    routeId: "/places/counties/$placeSlug",
    path: `/places/counties/${SEEDED.places.county}`,
    mode: "local",
  },
  {
    name: "place-metro",
    routeId: "/places/metros/$placeSlug",
    path: `/places/metros/${SEEDED.places.metro}`,
    mode: "local",
  },
  {
    name: "place-neighborhood",
    routeId: "/places/neighborhoods/$placeSlug",
    path: `/places/neighborhoods/${SEEDED.places.neighborhood}`,
    mode: "local",
  },
  {
    name: "place-district",
    routeId: "/places/districts/$placeSlug",
    path: `/places/districts/${SEEDED.places.district}`,
    mode: "local",
  },
  {
    name: "place-borough",
    routeId: "/places/boroughs/$placeSlug",
    path: `/places/boroughs/${SEEDED.places.borough}`,
    mode: "local",
  },
  {
    name: "public-directory",
    routeId: "/directories/$orgId",
    path: `/directories/${SEEDED.directoryOrgId}`,
    mode: "local",
  },
  {
    name: "claim-signed-out",
    routeId: "/claim/$slug",
    path: `/claim/${SEEDED.orgSlug}`,
    mode: "local",
  },
  {
    name: "claim-token-verification",
    routeId: "/claim/$slug",
    path: `/claim/${SEEDED.claimTokenSlug}`,
    mode: "local",
    search: { token: SEEDED.claimToken },
    note: "Token-verification state, reachable only with the tier-1 claim token from the demo seed.",
  },
  {
    name: "feedback",
    routeId: "/feedback/$slug",
    path: `/feedback/${SEEDED.personSlug}`,
    mode: "local",
  },
  {
    name: "not-found",
    routeId: "/",
    path: "/this-route-does-not-exist",
    mode: "local",
    expectPathname: "/this-route-does-not-exist",
    expectHttpStatus: 404,
    note: "Root notFoundComponent. A 404 document response is the correct answer here.",
  },

  // ------------------------------------------------------------- workspace
  { name: "home-workspace", routeId: "/home", path: "/home", mode: "local" },
  { name: "discovery", routeId: "/discovery", path: "/discovery", mode: "local" },
  { name: "coverage", routeId: "/coverage", path: "/coverage", mode: "local" },
  {
    name: "coverage-detail",
    routeId: "/coverage/$targetId",
    discovery: { fromPath: "/coverage", linkHrefPattern: "^/coverage/[^/]+$" },
    mode: "local",
  },
  { name: "briefs", routeId: "/briefs", path: "/briefs", mode: "local" },
  { name: "briefs-new", routeId: "/briefs/new", path: "/briefs/new", mode: "local" },
  {
    name: "brief-detail",
    routeId: "/briefs/$briefId",
    discovery: { fromPath: "/briefs", linkHrefPattern: "^/briefs/(?!new$)[^/]+$" },
    mode: "local",
  },
  { name: "lists", routeId: "/lists", path: "/lists", mode: "local" },
  {
    name: "list-detail",
    routeId: "/lists/$id",
    discovery: { fromPath: "/lists", linkHrefPattern: "^/lists/[^/]+$" },
    mode: "local",
  },
  { name: "watching", routeId: "/watching", path: "/watching", mode: "local" },
  { name: "feed", routeId: "/feed", path: "/feed", mode: "local" },
  {
    name: "manage-profile",
    routeId: "/manage/$slug",
    path: `/manage/${SEEDED.managedOrgSlug}`,
    mode: "local",
    note: "The seeded profile photo points at example.org, so the image slot renders empty by design.",
  },

  // ------------------------------------------------------ auth and billing
  { name: "sign-in", routeId: "/sign-in", path: "/sign-in", mode: "session" },
  { name: "sign-up", routeId: "/sign-up", path: "/sign-up", mode: "session" },
  {
    name: "setup",
    routeId: "/setup",
    path: "/setup",
    mode: "session",
    expectPathname: "/account",
    note: "A completed account is bounced out of /setup by requireIncompleteAtlasSession, so this is the post-setup landing. The real pre-setup screen is captured mid-sign-in as setup-passkey.",
  },
  { name: "pricing", routeId: "/pricing", path: "/pricing", mode: "session" },
  { name: "account", routeId: "/account", path: "/account", mode: "session" },
  {
    name: "organization",
    routeId: "/organization/",
    path: "/organization",
    mode: "session",
  },
  {
    name: "organization-sso",
    routeId: "/organization/sso",
    path: "/organization/sso",
    mode: "session",
    note: "Unconfigured state — SAML/SCIM connection state lives in the external auth provider.",
  },
  {
    name: "checkout-complete",
    routeId: "/checkout-complete",
    path: "/checkout-complete",
    mode: "session",
    search: { product: "atlas_team" },
    note: "Rendered without a real Stripe session id.",
  },
  { name: "onboarding", routeId: "/onboarding/", path: "/onboarding", mode: "session" },
  {
    name: "onboarding-complete",
    routeId: "/onboarding/complete",
    path: "/onboarding/complete",
    mode: "session",
  },
  {
    name: "accept-invitation-invalid",
    routeId: "/accept-invitation/$invitationId",
    path: "/accept-invitation/not-a-real-invitation",
    mode: "session",
    note: "Invalid-invitation state. Real invitation ids come from the membership service and cannot be seeded offline.",
  },
  {
    name: "device",
    routeId: "/device/",
    path: "/device",
    mode: "session",
    wait: { kind: "selector", selector: "main" },
    note: "Default state — device codes are issued live by the auth service.",
  },
  {
    name: "device-approved",
    routeId: "/device/approved",
    path: "/device/approved",
    mode: "session",
    wait: { kind: "selector", selector: "main" },
  },
  {
    name: "oauth-consent-unknown-client",
    routeId: "/oauth/consent",
    path: "/oauth/consent",
    mode: "session",
    search: { client_id: "atlas-audit-unknown-client" },
    wait: { kind: "selector", selector: "main" },
    note: "Unknown-client state. A valid consent screen needs a live authorization request.",
  },

  // ----------------------------------------------------------------- admin
  { name: "admin", routeId: "/admin/", path: "/admin", mode: "session" },
  {
    name: "admin-cloud-costs",
    routeId: "/admin/cloud-costs",
    path: "/admin/cloud-costs",
    mode: "session",
    note: "Posture is derived from deploy settings, not seeded rows.",
  },
  {
    name: "admin-discounts",
    routeId: "/admin/discounts",
    path: "/admin/discounts",
    mode: "session",
  },
  {
    name: "admin-profile-claims",
    routeId: "/admin/profile-claims",
    path: "/admin/profile-claims",
    mode: "session",
  },
] as const satisfies readonly ScreenshotRoute[];

/**
 * Routes deliberately not captured, with the reason shown in the audit index.
 *
 * Layout entries appear here because TanStack emits both the layout path and its index child
 * for the same URL; the index child is the one that renders.
 */
export const EXCLUDED_ROUTES = {
  "/dashboard": { reason: "Pure redirect to /home." },
  "/entries/$entryId": { reason: "Pure redirect to the canonical profile URL." },
  "/docs": { reason: "Redirect to the external Mintlify docs site." },
  "/docs/$": { reason: "Redirect to the external Mintlify docs site." },

  "/device": { reason: "Layout route; /device/ renders this URL." },
  "/onboarding": { reason: "Layout route; /onboarding/ renders this URL." },
  "/organization": { reason: "Layout route; /organization/ renders this URL." },
  "/profiles/organizations": {
    reason: "Layout route; /profiles/organizations/ renders this URL.",
  },
  "/profiles/people": { reason: "Layout route; /profiles/people/ renders this URL." },

  "/health": { reason: "Server route, not a page." },
  "/firehose.rss": { reason: "Feed response, not a page." },
  "/llms.txt": { reason: "Text response, not a page." },
  "/openapi.json": { reason: "JSON response, not a page." },
  "/robots.txt": { reason: "Text response, not a page." },
  "/sitemap.xml": { reason: "XML response, not a page." },

  "/device/approve": { reason: "Device-auth endpoint, not a page." },
  "/device/code": { reason: "Device-auth endpoint, not a page." },
  "/device/deny": { reason: "Device-auth endpoint, not a page." },
  "/device/status": { reason: "Device-auth endpoint, not a page." },
  "/device/token": { reason: "Device-auth endpoint, not a page." },

  "/.well-known/oauth-authorization-server/": { reason: "Metadata document, not a page." },
  "/.well-known/oauth-authorization-server/api/auth": {
    reason: "Metadata document, not a page.",
  },
  "/.well-known/oauth-protected-resource/": { reason: "Metadata document, not a page." },
  "/.well-known/oauth-protected-resource/mcp": { reason: "Metadata document, not a page." },

  "/api/$": { reason: "API proxy, not a page." },
  "/api/health": { reason: "API route, not a page." },
  "/api/auth/$": { reason: "API route, not a page." },
  "/api/auth/internal/api-key": { reason: "API route, not a page." },
  "/api/auth/internal/memberships/$organizationId/members/$userId": {
    reason: "API route, not a page.",
  },
  "/api/stripe/webhook": { reason: "API route, not a page." },
  "/api/atproto/oauth/callback": { reason: "API route, not a page." },
  "/api/atproto/oauth/client-metadata.json": { reason: "API route, not a page." },
  "/api/atproto/oauth/harness/authorize": { reason: "E2E harness route, not a page." },
  "/api/atproto/oauth/start": { reason: "API route, not a page." },
  "/api/atproto/sign-in/start": { reason: "API route, not a page." },
  "/api/e2e/hosted/identity": { reason: "E2E seed route, not a page." },
  "/api/e2e/workspace/member": { reason: "E2E seed route, not a page." },
} as const satisfies Partial<Record<AtlasRoutePath, ExcludedRoute>>;

/**
 * The manifest widened to the declared interface.
 *
 * `SCREENSHOT_ROUTES` keeps its literal types so the coverage guard below can read every
 * `routeId`, but that also means optional fields are absent from entries that omit them.
 * Runtime consumers want the uniform shape, so they read this instead.
 */
export const CAPTURE_ROUTES: readonly ScreenshotRoute[] = SCREENSHOT_ROUTES;

type CapturedPath = (typeof SCREENSHOT_ROUTES)[number]["routeId"];
type ExcludedPath = keyof typeof EXCLUDED_ROUTES;

/** Any route that is neither captured nor explicitly excluded. Must be `never`. */
type UncoveredPath = Exclude<AtlasRoutePath, CapturedPath | ExcludedPath>;

type AssertNever<T extends never> = T;

/**
 * Compile-time proof that the manifest covers every route in `routeTree.gen.ts`.
 *
 * Adding a route without listing it above makes `UncoveredPath` non-`never`, so `tsc` fails
 * here and names the missing path. Renaming or deleting a route breaks the `satisfies` clauses
 * above on the stale key.
 */
export type RouteCoverageIsComplete = AssertNever<UncoveredPath>;
