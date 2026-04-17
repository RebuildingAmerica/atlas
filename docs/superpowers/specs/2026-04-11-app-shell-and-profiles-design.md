# App Shell Restructure & Actor Profiles Design

Date: 2026-04-11

## Context

Atlas's current layout applies the same sticky header and nav chrome to every page, including auth pages. The result feels like a generic SaaS dashboard rather than an exploratory research tool. The entry detail page is a flat card — a "thin directory row" — not a first-class research object.

This spec covers two related changes:

1. **Restructure the app shell** into three layout zones with distinct chrome, so public pages feel immersive, operator pages feel like a cohesive workspace, and auth pages are self-contained.
2. **Introduce actor profiles** for people and organizations that are differentiated by type and designed as genuine research surfaces.

## Part 1: Layout Architecture

### Three Layout Zones

The app splits into three zones, each implemented as a **pathless layout route** in TanStack Router (underscore prefix convention). The root layout strips down to a bare document shell.

#### Route Structure

```
src/routes/
  __root.tsx                     # HTML document + providers + <Outlet /> only
  _public.tsx                    # Public Exploration layout
  _public/
    index.tsx                    # /
    browse.tsx                   # /browse
    entries.$entryId.tsx         # /entries/:entryId
  _workspace.tsx                 # Operator Workspace layout
  _workspace/
    account.tsx                  # /account
    discovery.tsx                # /discovery
  _auth.tsx                      # Auth Flow layout
  _auth/
    sign-in.tsx                  # /sign-in
    account-setup.tsx            # /account-setup
    oauth/
      consent.tsx                # /oauth/consent
  api/
    auth/
      $.ts                       # /api/auth/* (server-only, unchanged)
```

URLs do not change. The underscore-prefixed layout routes are pathless — `/browse` stays `/browse`.

#### Root Layout (`__root.tsx`)

Strips to:

- `QueryClientProvider` wrapping
- `<html>`, `<head>` with meta tags, `<HeadContent />`
- `<body>` with base styles
- `<Outlet />` where layout routes render
- `<Scripts />`

All nav chrome (sticky header, pill-style nav, mobile bottom nav, `DesktopAuthNav`) is removed from root. The `queryClient` instantiation stays.

#### Public Exploration Layout (`_public.tsx`)

**Pages:** `/` (home), `/browse`, `/entries/:entryId`

**Chrome:** Floating contextual nav — a small floating element with the Atlas logo mark and sparse contextual links. Not a sticky full-width bar. Adapts per page.

**Content area:** Full-viewport width. No max-width constraint at the layout level. Individual pages control their own content width and spacing.

**No mobile bottom nav.** Navigation is woven into the content itself.

**No layout-level auth guard.** Public pages are open.

**Vibe:** Immersive. The content IS the interface. Three visual concepts feed into the identity:
- **Map-first:** The US map as a primary navigation surface
- **Narrative entry point:** Editorial headlines and curated collections invite browsing
- **Data canvas:** Dark tones, research-instrument aesthetic, abstract data visualization

The home page combines map-first and narrative — a full-viewport interactive map with editorial headlines and curated collection cards floating over/alongside it.

#### Operator Workspace Layout (`_workspace.tsx`)

**Pages:** `/account`, `/discovery`

**Chrome:** Functional top nav with workspace section tabs (Account, Discovery), user identity display, and sign-out action. Atlas logo links back to `/`.

**Content area:** Constrained with max-width and padding. Page components do not need their own `PageLayout` wrapper.

**Auth guard:** Centralized at the layout level via `beforeLoad` calling `requireReadyAtlasSession`. Individual child routes remove their own guards — the layout enforces authentication once. Session data flows to children via route context.

**Visual language:** Same color palette, typography scale, and component family as public pages. Clearly a different mode (conventional tool layout), same family.

#### Auth Flow Layout (`_auth.tsx`)

**Pages:** `/sign-in`, `/account-setup`, `/oauth/consent`

**Chrome:** None. Self-contained, full-bleed.

**Structure:** Split layout at desktop:
- **Left panel (~40%):** Dark background (`#1f1812`). Atlas logo, tagline ("Map the people rebuilding America."), subtle decorative data-viz dots. Static across all auth pages.
- **Right panel (~60%):** Cream background (`#fbf7f0`). `<Outlet />` renders the form content. "Back to Atlas" link.

**Mobile:** Single column. Brand panel collapses to a small logo header. Form takes full width.

**No layout-level auth guard.** Each auth page has different requirements:
- `/sign-in` — no guard (unauthenticated users)
- `/account-setup` — keeps `beforeLoad` with `requireIncompleteAtlasSession`
- `/oauth/consent` — keeps its own `validateSearch`

### Page-Level Changes

#### Home Page (`/`)
- Drops `PageLayout` entirely — goes full-viewport
- Map-first hero with the US map filling the viewport
- Narrative elements: editorial headline + curated collection cards
- Search bar integrated into the composition
- Data canvas aesthetic throughout

#### Browse Page (`/browse`)
- Keeps its own content structure
- Chrome comes from public layout's floating nav
- Map + filter + entry list continue to work

#### Entry Detail (`/entries/:entryId`)
- Narrower reading column for the profile (see Part 2)
- Floating nav stays minimal

#### Operator Pages (`/account`, `/discovery`)
- Remove `<PageLayout>` wrappers — workspace layout provides the container
- Remove individual `beforeLoad` auth guards — workspace layout handles it

#### Auth Pages (`/sign-in`, `/account-setup`, `/oauth/consent`)
- Remove `<PageLayout>` wrappers and outer `<section>` containers
- Render form content directly inside the auth layout's right panel

### New Components

| Component | Location | Purpose |
|---|---|---|
| `PublicFloatingNav` | `src/platform/layout/public-nav.tsx` | Floating logo + contextual links over content |
| `WorkspaceLayout` | `src/platform/layout/workspace-layout.tsx` | Top nav shell + constrained content area |
| `WorkspaceNav` | `src/platform/layout/workspace-nav.tsx` | Section tabs, user identity, sign-out |
| `AuthFlowLayout` | `src/platform/layout/auth-layout.tsx` | Split-panel: dark brand left, form right |
| `AuthBrandPanel` | `src/platform/layout/auth-brand-panel.tsx` | Logo, tagline, decorative data-viz dots |

The existing `PageLayout` at `src/platform/layout/page-layout.tsx` remains as a utility for pages that want a centered max-width container.

## Part 2: Actor Profiles

### Scope

Profiles are exclusively for **actors** — people and organizations. Initiatives, campaigns, and events get separate views (not covered in this spec).

Profiles replace the current `EntryDetail` component for actor-type entries at `/entries/:entryId`. The route stays the same; the rendered component switches based on `entry.type`.

### Design Principles

Every profile answers five questions (from the Atlas roadmap):
1. **Who** this actor is
2. **What** they do
3. **Where** they operate
4. **Why** they matter
5. **How Atlas knows** (source-backed evidence)

Profiles are research objects, not directory rows.

### Shared Structure

Both person and organization profiles share:
- **Dark header** (`#1f1812`) for identity: type label, trust badges, name, location
- **Cream body** (`#fbf7f0`) for content sections
- Bold name treatment: 22px / font-weight 700 / slight negative letter-spacing
- "Appearances & mentions" reframing of the source trail
- Browsable lists with "view all" entry points to full list views

### Person Profile

| Section | Content | Design |
|---|---|---|
| **Identity** (dark header) | Type label ("Person"), verified badge, mention count, avatar (circular, photo slot with initials fallback), bold name, role subtitle (e.g., "Founder, Prairie Workers Cooperative"), location + geo-specificity pills | Circular 56px avatar with gradient initials fallback. Name at 22px/700. Role in muted text below. |
| **About** | 1-3 sentence description | Body text, standard line height |
| **Issue focus** | Flat list of issue area tags | Accent-colored pills (`#f4d3b6` background, `#773714` text) |
| **Organization** | Linked card showing affiliated org's logo mark, name, location | Card with square logo mark (32px, rounded 8px), navigates to org profile |
| **Reach** | Email, website, phone (when available) | Stacked cards with icon (28px icon container) + label + value. Personal and actionable feel. |
| **Appearances & mentions** | First appearance expanded with extraction context quote. Remaining as compact list rows (source type badge + publication + date). Total count badge. "View all N appearances" browse link. | First item: full card with dark source-type badge, title, date, extraction context in a left-bordered quote block (`#d07534` border). List items: compact rows with colored type badges. |

### Organization Profile

| Section | Content | Design |
|---|---|---|
| **Identity** (dark header) | Type label ("Organization"), verified badge, mention count, logo mark (square, rounded corners), bold name, location + geo-specificity + active status pills | Square 52px logo mark with rounded 12px corners and gradient fallback. Name at 22px/700. Active status pill uses green tint. |
| **Mission** | Description of what the org does | Body text, standard line height |
| **Issue footprint** | Issue areas grouped by taxonomy domain | Domain name as a muted label, then issue area pills underneath. Different domains visually separated. Uses domain-specific tint colors where possible. |
| **People** | Affiliated persons | **Avatar row + detail panel.** Compact circular avatars (44px) with first-name labels in a horizontal row. Tap/click an avatar to expand a detail panel below showing: larger avatar + full name + role + mention count, bio snippet, issue tags, "View full profile" link. |
| **Presence** | Website, email, phone, first-seen date | Prominent website card (32px dark icon container + domain + "Visit" action pill). Then a 2-column grid for email, phone, and metadata like first-seen date. Each grid cell has icon + label + value. |
| **Appearances & coverage** | Coverage breakdown bar (source type distribution as a stacked horizontal bar with legend), then compact list rows. Total count badge. "Browse all N appearances" link. | Stacked bar chart (6px height, rounded, color-coded by source type). Legend below with type labels and counts. Then compact list rows with colored type badges. |

### Key Differentiators

| Aspect | Person | Organization |
|---|---|---|
| Avatar shape | Circular (photo) | Square with rounded corners (logo) |
| Role display | Subtitle under name | N/A (org doesn't have a "role") |
| Org affiliation | Linked card to org profile | N/A |
| People section | N/A | Avatar row + expandable detail panel |
| Issue display | Flat tags | Grouped by taxonomy domain |
| Contact framing | "Reach" — personal, compact | "Presence" — institutional, grid with prominent website |
| Source trail framing | "Appearances & mentions" — quotes/context | "Appearances & coverage" — type breakdown bar |

### Source Trail Reframing

The current "Source trail" is reframed as:
- **Person:** "Appearances & mentions" — where the person has been mentioned, quoted, or featured in public sources
- **Organization:** "Appearances & coverage" — the org's media coverage and public record

This connects to the trust layer: more appearances from diverse source types = higher confidence. The breakdown bar on org profiles makes this legible at a glance.

Both include:
- A count badge showing total appearances
- Compact list rows for individual sources
- A "browse all" link to a full paginated list view with filters

### Data Requirements

Actor profiles work with the existing data model. No schema changes are required. All data comes from the existing `Entry`, `Source`, `EntrySource`, and `EntryIssueArea` tables.

The `affiliated_org_id` field on entries powers the person-to-org and org-to-people relationships:
- Person profile's "Organization" section: query the entry's `affiliated_org_id`
- Org profile's "People" section: query all entries where `affiliated_org_id` matches this org's ID

The taxonomy grouping (issue areas by domain) uses the existing taxonomy structure from `docs/the-atlas-taxonomy.md`.

### Routing

The existing route at `/entries/:entryId` continues to serve profiles. The `EntryPage` component checks `entry.type`:
- `"person"` or `"organization"` → render the appropriate profile component
- Other types → render a different detail view (out of scope for this spec)

### New Components

| Component | Location | Purpose |
|---|---|---|
| `PersonProfile` | `src/domains/catalog/components/profiles/person-profile.tsx` | Full person profile layout |
| `OrgProfile` | `src/domains/catalog/components/profiles/org-profile.tsx` | Full organization profile layout |
| `ProfileHeader` | `src/domains/catalog/components/profiles/profile-header.tsx` | Dark header with identity (shared between person/org with type-specific slots) |
| `ActorAvatar` | `src/domains/catalog/components/profiles/actor-avatar.tsx` | Circular (person) or square (org) avatar with initials fallback and photo/logo slot |
| `AvatarRow` | `src/domains/catalog/components/profiles/avatar-row.tsx` | Horizontal avatar row with expandable detail panel for org's people section |
| `AppearancesList` | `src/domains/catalog/components/profiles/appearances-list.tsx` | Compact source list with type badges, expandable first item (person) or breakdown bar (org) |
| `IssueFootprint` | `src/domains/catalog/components/profiles/issue-footprint.tsx` | Issue areas grouped by taxonomy domain (org profiles) |
| `ReachSection` | `src/domains/catalog/components/profiles/reach-section.tsx` | Person contact: stacked icon+label cards |
| `PresenceSection` | `src/domains/catalog/components/profiles/presence-section.tsx` | Org contact: prominent website card + grid |

## Verification

### Layout restructure
1. Run `pnpm dev` after moving route files — verify `routeTree.gen.ts` regenerates correctly
2. Navigate to each route and verify correct layout renders
3. Verify auth guards still work: unauthenticated user hitting `/account` redirects to sign-in
4. Verify mobile responsiveness: auth pages collapse to single column, public pages are full-viewport
5. Verify no regressions in existing functionality (search, browse filters, entry loading)

### Actor profiles
1. Navigate to a person entry — verify person profile renders with all sections
2. Navigate to an org entry — verify org profile renders with differentiated sections
3. Click org affiliation on a person profile — navigates to org profile
4. Click a person in org's avatar row — detail panel expands with bio and profile link
5. Click "View all appearances" — navigates to full browsable list
6. Verify initiative/campaign/event entries still render their detail view (not a profile)
7. Verify mobile responsiveness: profiles stack vertically, avatar row scrolls horizontally
