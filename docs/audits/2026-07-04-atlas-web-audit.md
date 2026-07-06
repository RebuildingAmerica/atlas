# Atlas Web Standards, Performance, Accessibility, and Metadata Audit

Date: 2026-07-04

Audit target: current dirty `main` checkout in
`/Users/williecubed/Projects/RebuildingAmerica/atlas`.

Raw artifacts: `/tmp/atlas-audit/`

## Summary

Atlas has meaningful foundations in place: route-level metadata exists for many
public pages, profile routes have canonical/OG/Twitter metadata in source and
unit tests, `sitemap.xml` exists, profile JSON-LD is implemented in React, app
lint/typecheck pass, and Lighthouse SEO scores read as 100 on sampled routes.

The audit still found several issues that directly affect the public civic
discovery and trust experience:

- The sitemap endpoint currently fails against the API because it requests
  `limit=10000` where the API caps `limit` at 100.
- Every sampled SSR page emits duplicate `<title>` and duplicate description
  metadata, and the W3C validator reports this as invalid HTML.
- The most important public discovery flows have accessibility gaps: unlabeled
  search fields, invisible map skip target, incomplete combobox semantics,
  visual-only filter state, and weak evidence/source navigation.
- Mobile performance is not yet acceptable for core discovery routes. Lighthouse
  scored `/browse` at 58 and `/map` at 35, with `/map` at 13.0s interactive and
  0.791 CLS.
- The public map can ship without a real basemap because `ATLAS_MAP_STYLE_URL`
  is read client-side but not exposed through Vite public env config.
- Regression tooling has command drift: root `test:e2e` does not run Playwright,
  `test:e2e:headed` has no app script, `openapi:lint` resolves to
  `<NONEXISTENT>`, and production verification only prints a success message.

Standards references used for criteria: WCAG 2.2 AA, Playwright accessibility
testing with axe, Chrome Lighthouse, Google Search Central
SEO/robots/structured-data/Core Web Vitals guidance, W3C Nu HTML Checker, and
the Open Graph protocol.

## Commands And Artifacts

Passed:

```bash
pnpm run turbo:validate
cd app && pnpm run typecheck
cd app && pnpm run lint
cd app && pnpm run build
cd app && pnpm vitest run tests/unit/platform/seo.test.ts \
  tests/unit/routes/_public.index.test.tsx \
  tests/unit/routes/_public.browse.test.tsx \
  tests/unit/routes/_public.map.test.tsx \
  tests/unit/routes/_public.profiles.people.slug.test.tsx \
  tests/unit/routes/_public.profiles.organizations.slug.test.tsx \
  tests/unit/routes/_public.profiles.non_actor.slug.test.tsx \
  tests/unit/routes/sitemap-xml.test.ts \
  tests/unit/domains/catalog/components/profile-head.test.tsx
```

Key passing evidence:

- `/tmp/atlas-audit/logs/turbo-validate.log`: all 17 Turbo selectors resolve.
- `/tmp/atlas-audit/logs/app-typecheck.log`: TypeScript check completed with
  exit 0.
- `/tmp/atlas-audit/logs/app-lint.log`: ESLint completed with exit 0.
- `/tmp/atlas-audit/logs/app-build.log`: build completed in 2m15s.
- `/tmp/atlas-audit/logs/metadata-vitest.log`: 9 files and 38 tests passed.
- `/tmp/atlas-audit/logs/acceptance-list.log`: 12 Playwright acceptance tests
  listed.

Failed or warning evidence:

- `/tmp/atlas-audit/logs/organization-page-vitest.log`: one focused unit test
  failed in `RenewalSignalsGrid`.
- `/tmp/atlas-audit/logs/root-test-e2e.log`: root `test:e2e` runs empty
  `tests/e2e`.
- `/tmp/atlas-audit/logs/root-test-e2e-headed.log`: no `test:e2e:headed` script.
- `/tmp/atlas-audit/logs/openapi-lint-dry.log`:
  `@rebuildingamerica/atlas-app#openapi:lint` command is `<NONEXISTENT>`.
- `/tmp/atlas-audit/logs/prod-verify.log`: only prints
  `Atlas production verification graph completed`.
- `/tmp/atlas-audit/html/validator-summary.txt`: W3C validator errors on
  duplicate description/title and streamed null characters.
- `/tmp/atlas-audit/lighthouse/score-summary-full.txt`: desktop and mobile
  Lighthouse scores.

## Findings

### Critical: Map Basemap Env Is Not Exposed To The Client

Evidence:

- `app/src/domains/catalog/map/map-config.ts` reads `ATLAS_MAP_STYLE_URL` and
  falls back to `https://maptiler.invalid/maps/atlas-placeholder/style.json`.
- `app/vite.config.ts` exposes `ATLAS_DEPLOY_MODE`, `ATLAS_PUBLIC_URL`,
  `ATLAS_DOCS_URL`, `ATLAS_AUTH_BASE_PATH`, and `ATLAS_SERVER_API_PROXY_TARGET`,
  but not `ATLAS_MAP_STYLE_URL`.
- `app/vercel.ts` app CSP only allows `connect-src 'self'` plus Vercel
  endpoints.

Impact:

The public civic map can render with no basemap tiles, making a primary
discovery surface feel broken. Even after exposing the env var, the current CSP
likely blocks external style/tile/glyph requests unless the map provider origins
are allowed.

Likely fix:

Expose a client-safe map style env value, fail production builds when it
resolves to the placeholder, and add vetted map style/tile/glyph origins to CSP.

### High: Sitemap Fails Against API Limit Validation

Evidence:

- `app/src/routes/sitemap[.]xml.ts` calls
  `api.entries.list({ entry_types: ["person"], limit: 10000 })` and the same for
  organizations.
- Runtime capture: `/tmp/atlas-audit/metadata/sitemap.headers` shows
  `HTTP/1.1 422 Unprocessable Entity`.
- API logs showed `/api/entities?entity_type=person&limit=10000` returning 422
  because `limit` must be <= 100.

Impact:

Search engines cannot consume the generated sitemap. This hurts discovery of
source-linked public profiles, which are one of Atlas's highest-trust public
entry points.

Likely fix:

Paginate sitemap entity fetches with the API-supported limit, or add a dedicated
sitemap feed endpoint that returns only crawlable URL metadata.

### High: Duplicate Head Metadata Produces Invalid HTML

Evidence:

- `app/src/routes/__root.tsx` renders `<HeadContent />`, then manually renders
  root description and `<title>The Atlas</title>`.
- `/tmp/atlas-audit/metadata/head-snippets.txt` shows route-specific
  title/description followed by root description and `The Atlas`.
- `/tmp/atlas-audit/html/validator-summary.txt` reports: duplicate description
  and `Element "title" not allowed as child of element "head" in this context`.

Impact:

Crawlers and social parsers may choose generic or conflicting metadata. This
weakens search snippets and profile sharing, especially for named people and
organizations where specificity builds trust.

Likely fix:

Move default metadata into route `head()` fallbacks or a single shared SEO
helper. Do not manually emit root title/description after `HeadContent` when
route heads are active.

### High: Primary Discovery Search Inputs Lack Durable Accessible Names

Evidence:

- `app/src/platform/pages/home-page.tsx` search input uses placeholder text such
  as `Try housing in Detroit`.
- `app/src/domains/catalog/components/browse/browse-page-sections.tsx` browse
  search field similarly relies on visual/placeholder context.
- `/tmp/atlas-audit/metadata/rerun_home.html` confirms an input with placeholder
  but no durable label.

Impact:

Search is the front door to civic discovery. Placeholder-only naming makes the
search experience weaker for screen-reader and voice-control users, and
placeholder text disappears during input.

Likely fix:

Add visible or `sr-only` labels with `htmlFor`, or use
`aria-label`/`aria-labelledby` where visible labels would harm layout.

### High: Map Keyboard And Screen-Reader Flow Is Not Complete

Evidence:

- `app/src/domains/catalog/components/map/map-page.tsx` has a skip link to a
  screen-reader-only results list.
- `app/src/domains/catalog/components/map/map-command-bar.tsx` exposes
  combobox/listbox roles without a complete active-descendant and arrow-key
  interaction model.
- `app/src/domains/catalog/components/map/map-detail-panel.tsx` points dialog
  labeling at a wrapper rather than the precise visible heading.

Impact:

Keyboard and screen-reader users can reach invisible results or receive unstable
map dialog announcements. This blocks the map from serving as a trustworthy
exploration surface for all users.

Likely fix:

Reveal the results list when skipped/focused, or provide a visible list drawer.
Replace the command bar with a proven combobox implementation or fully implement
`aria-activedescendant`, option ids, selection state, and arrow-key behavior.
Put dialog ids on stable visible headings.

### High: Mobile Performance Fails Core Discovery Expectations

Evidence from `/tmp/atlas-audit/lighthouse/score-summary-full.txt`:

- `/browse` mobile: performance 58, LCP 8.3s, interactive 8.3s, speed index
  7.8s.
- `/map` mobile: performance 35, LCP 7.4s, interactive 13.0s, CLS 0.791, speed
  index 7.2s.
- Desktop `/browse`: performance 67, LCP 2.9s.
- Built public assets include `main-C0sy0h_S.js` at about 780K and
  `maplibre-gl-B7cUrSx4.js` at about 1.1M
  (`/tmp/atlas-audit/bundle/static-sizes.txt`).

Impact:

The user-visible discovery path is slow on mobile, especially browse and map. A
random public visitor may leave before the civic data becomes usable.

Likely fix:

Add bundle budgets and route-specific Lighthouse checks. Split map/vendor code
more aggressively, keep MapLibre out of non-map routes, lazy-load the
interactive map after visible first content, and SSR a useful browse/map results
shell.

### High: Profile SSR Captures Lack Visible Profile Body And JSON-LD

Evidence:

- `ProfileJsonLd` is implemented in `person-profile-page.tsx` and
  `org-profile-page.tsx`.
- `/tmp/atlas-audit/metadata/rerun_people_profile.html` contains profile head
  metadata and streamed route data, but
  `/tmp/atlas-audit/metadata/semantic-counts.txt` reports zero `<h1>`, zero
  `<main>`, and zero `application/ld+json` for `rerun_people_profile` and
  `rerun_org_profile`.
- `rg` confirms source usage of `ProfileJsonLd`, but live SSR HTML did not
  contain `application/ld+json`.

Impact:

Search crawlers may receive metadata and serialized data without the visible
evidence/trust content or structured data script. That undermines profile
indexability and rich entity understanding.

Likely fix:

Investigate TanStack Start streaming/SSR behavior for profile detail pages and
ensure crawlers receive rendered profile body, headings, source sections, and
JSON-LD in the initial HTML.

### High: Regression Commands Do Not Mean What They Say

Evidence:

- `pnpm run test:e2e` fails because it runs `vitest run tests/e2e` and no files
  exist there (`/tmp/atlas-audit/logs/root-test-e2e.log`).
- `pnpm run test:e2e:headed` fails because the app has no such script
  (`/tmp/atlas-audit/logs/root-test-e2e-headed.log`).
- `pnpm exec turbo run '@rebuildingamerica/atlas-app#openapi:lint' --dry=json`
  exits 0 but shows `command: "<NONEXISTENT>"`.
- The production verification command exits 0 but only prints a completion line.

Impact:

Maintainers can believe browser, OpenAPI, and production verification gates ran
when they did not. That is a trust problem for the engineering process behind a
trust-centered product.

Likely fix:

Map root `test:e2e` to Playwright acceptance or rename docs/scripts. Add a real
`test:e2e:headed` alias or remove references. Add a real `openapi:lint` script
and teach `turbo:validate` to fail on `<NONEXISTENT>` commands. Make production
verification depend on actual checks.

### High: Current Unit Regression In Organization Page

Evidence:

- `cd app && pnpm vitest run tests/unit/domains/access/pages/organization-page.test.tsx`
  failed 1 of 7 tests.
- Failure: `RenewalSignalsGrid` calls
  `Object.entries(usageSummary.event_counts)` when `event_counts` is undefined.
- Log: `/tmp/atlas-audit/logs/organization-page-vitest.log`.

Impact:

Workspace admins can hit a crash path instead of managing team, SSO, or renewal
state. This is not a public search issue, but it means current app unit gates
are not green.

Likely fix:

Fix the fixture or component contract so `usageSummary.event_counts` is always
present, and add explicit loading/empty/ready coverage.

### Medium: Robots And LLM Discovery Files Are Missing

Evidence:

- `/tmp/atlas-audit/metadata/status-matrix-final.txt` shows
  `robots HTTP/1.1 404` and `llms HTTP/1.1 404`.
- File scan found only `app/src/routes/sitemap[.]xml.ts`.

Impact:

Search engines get no explicit sitemap advertisement or crawl policy, and answer
engines get no concise canonical map of Atlas public content.

Likely fix:

Add `robots.txt` with `Sitemap:` and a clear index/disallow policy. Add
`llms.txt` for public Atlas content, sources, and docs.

### Medium: Static Public Routes Lack Canonical And Social Card Strategy

Evidence:

- `/`, `/browse`, and `/map` have title/description but no canonical links,
  OG/Twitter metadata, or social images in sampled head snippets.
- Profile routes have OG/Twitter tags but no `og:image`/`twitter:image`.

Impact:

Search engines get weaker duplicate-URL handling, and shared civic discovery
links are generic or text-only. For named civic actors, visual trust cues
matter.

Likely fix:

Create a shared SEO helper for canonical, OG/Twitter, route images, and query
canonical policy. Add a default Atlas social image and profile-specific images
when available.

### Medium: Canonical Origin Policy Is Split

Evidence:

- `app/src/platform/seo.ts` defaults to `https://atlas.rebuildingamerica.com`.
- `app/src/routes/sitemap[.]xml.ts` hard-codes the same origin rather than using
  runtime public origin.
- `.env.production` and captures from subagent evidence indicated production may
  use a different public origin.
- Local route capture showed profile `og:url`/canonical as
  `https://atlas.localhost:1355/...`, not the requested
  `ATLAS_PUBLIC_URL=http://127.0.0.1:3100`, which means environment precedence
  needs checking.

Impact:

Canonical and sitemap URLs can split indexing across domains or environments.

Likely fix:

Centralize public origin resolution and use the same helper for canonicals,
sitemap, OG URLs, structured data, and share URLs.

### Medium: Browse Filter State Is Visual-Only

Evidence:

- `browse-page-sections.tsx` filter options show check icons and active styling,
  but do not expose `aria-pressed`, `aria-checked`, `checkbox`, or
  `menuitemcheckbox` semantics.

Impact:

Screen-reader users may hear selected and unselected filters identically, making
source-quality and issue filtering unreliable.

Likely fix:

Model filter options as toggle buttons with `aria-pressed`, or as
checkbox/menuitemcheckbox controls with explicit checked state.

### Medium: Profile Evidence Navigation Is Too Thin

Evidence:

- `appearances-list.tsx` exposes the lead source as a link, but compact source
  rows are not all keyboard-navigable source links.
- Profile detail primitive labels are often region labels or paragraphs rather
  than headings.

Impact:

Atlas's core trust experience is inspecting sources and confidence. If evidence
sections cannot be navigated by heading or keyboard, users have a harder time
verifying claims.

Likely fix:

Render source rows as navigable links with publication/date context. Ensure
profile trust/evidence sections use real headings with a consistent outline.

### Medium: Form Error Text Is Not Programmatically Associated

Evidence:

- `app/src/platform/ui/input.tsx`, `select.tsx`, and `textarea.tsx` render
  visible error text but do not consistently wire `aria-invalid` and
  `aria-describedby`.

Impact:

Users may not hear what failed when focusing an invalid control, especially in
claim, feedback, auth, and workspace forms.

Likely fix:

Generate error ids in primitives, set `aria-invalid` when error exists, wire
`aria-describedby`, and use appropriate alert/status regions for submit-level
errors.

### Medium: Auth Pages Lack Main Landmark And Noindex Policy

Evidence:

- `auth-layout.tsx` wraps content in `div`s, not `<main>`.
- `/tmp/atlas-audit/metadata/signin.html` shows generic root metadata only.
- No `robots noindex` was found for auth pages.

Impact:

Sign-in/sign-up pages are weaker for landmark navigation and can be indexed with
generic Atlas metadata.

Likely fix:

Wrap auth content in `<main>` and set auth-route metadata with
`robots: noindex, nofollow`.

### Medium: Public Route Loader Waits On Operational Status

Evidence:

- `_public.tsx` loader awaits `getStatus("atlasapp")` for every public route.

Impact:

Public TTFB can depend on OpenStatus availability even for search/profile pages
where operational status is footer decoration.

Likely fix:

Move status fetching to a client/footer fetch, or use a stale cached server
value that never blocks primary content.

### Medium: CSP Does Not Match Fonts And Map Requirements

Evidence:

- `app/src/styles/app.css` imports Google Fonts.
- `app/vercel.ts` app CSP allows `style-src 'self' 'unsafe-inline'` and
  `font-src 'self' data:`, but only docs routes allow Google Fonts.
- Map external style/tile/glyph origins are not in app `connect-src`.

Impact:

Production can block fonts today and map assets once a real map style URL is
configured.

Likely fix:

Self-host/subset fonts or align app CSP with intended font origins. Add approved
map asset origins to `connect-src`.

### Medium: Browse-To-Map Filter Semantics Drop Source Pattern

Evidence:

- Browse preserves `source_patterns`; map params and API map endpoint do not
  carry the same source-pattern filter.

Impact:

A user who filters for source quality can switch to the map and see broader,
less-trusted results than expected.

Likely fix:

Add `source_pattern` through OpenAPI, map route search schema, `MapPointParams`,
client mapping, API search, and tests.

### Low: External Profile Images Need A Central Loading Policy

Evidence:

- `actor-avatar.tsx` and `profile-showcase-primitives.tsx` render remote images
  without explicit loading/decoding/referrer/fetch-priority policy or intrinsic
  sizing.

Impact:

Remote profile photos can compete with critical work and add LCP/privacy risk.

Likely fix:

Create a profile image primitive with dimensions/aspect ratio, `loading`,
`decoding`, `referrerPolicy`, and controlled eager priority.

### Low: Coverage Policy Docs Drift

Evidence:

- Repo instructions mention frontend 80% coverage, while Vitest config enforces
  100%.

Impact:

Contributors may run or tune the wrong gate.

Likely fix:

Align AGENTS, CLAUDE, docs, and config around the actual intended policy.

## Remediation Order

1. Fix crawlability and metadata correctness: sitemap pagination, duplicate root
   head tags, robots, canonical origin helper, auth noindex.
2. Fix public discovery accessibility: search labels, map skip/list flow, map
   combobox, filter state, profile evidence headings/source links, form error
   associations.
3. Fix mobile performance: map env/CSP, MapLibre lazy loading, browse/map route
   shell, bundle budgets, Lighthouse checks.
4. Fix regression tooling: e2e script naming, `openapi:lint`, production
   verification, a11y/SEO/performance gates, and the current organization-page
   unit failure.
5. Add long-term trust polish: OG image pipeline, JSON-LD SSR verification,
   `llms.txt`, external image primitive, richer public acceptance journeys.

## Suggested Regression Coverage

- Playwright + axe checks for `/`, `/browse`, `/map`, `/profiles`, one person
  profile, one organization profile, `/claim/:slug`, `/feedback/:slug`,
  `/sign-in`, and `/account`.
- SSR request tests asserting a route matrix has exactly one title, one
  description, expected canonical/noindex policy, OG/Twitter coverage, and
  profile JSON-LD where expected.
- Sitemap tests that seed more than 100 actors and prove pagination.
- Lighthouse CI or equivalent budget for home, browse, map, and profile routes,
  with mobile thresholds.
- Bundle-size guard for the main public chunk and MapLibre chunk.
- Browser journeys for browse filters/results, map search/marker/detail/list,
  profile evidence/source trust, and keyboard paths.
