# Admin Portal Standards

The admin portal is an operator workbench, not a collection of unrelated tool
pages. It should help an operator understand service posture and review queues
quickly on desktop and mobile.

Two operator surfaces exist and they stay separate:

- **The Atlas app's editorial pages** (`/editorial`): running this instance.
  Editorial review, corrections, profile verifications and discovery schedules,
  for the people on `ATLAS_INSTANCE_OPERATOR_EMAILS`. Every deployment has them,
  including self-hosted ones. Old `/admin/*` addresses redirect here, except the
  two pages that moved to the platform admin.
- **The Atlas platform admin** (`admin/`, its own host behind Cloudflare
  Access): Atlas-owned administration of the managed service, such as discount
  requests and cloud costs. Only the managed deployment has it. See
  [Internal Apps](./internal-apps.md).

## Page Organization

Every top-level admin page should use the same file shape:

- `app/src/routes/_workspace/editorial/<page>.tsx` (or
  `admin/src/routes/<page>.tsx`) only registers the route.
- `<workspace>/src/domains/**/<page>-page.tsx` loads data, owns mutations, and
  renders loading, error, or empty states.
- `<workspace>/src/domains/**/<page>-view.tsx` renders the page UI.
- Shared chrome, status badges, metric cards, loading states, and error states
  come from `@rebuildingamerica/atlas-ui/layout/admin-portal`, so both surfaces
  read the same.

Do not put full component implementations in route files or page entrypoints. If
a page needs cards, rows, sections, or formatting helpers, put them in the view
module or a colocated component module.

## Navigation

The workspace rail exposes one top-level `Editorial` destination, shown only to
instance operators. Detailed operator tasks live inside it as action links. This
keeps the rail scannable on mobile and desktop and avoids adding a new rail item
for every operator workflow.

## Service Health

The admin dashboard should surface key health indicators without creating a
second source of truth. Use existing data surfaces before adding new endpoints:

- API health comes from `/health`.
- Discovery pipeline posture comes from `/api/discovery-runs/summary`.
- Cost posture comes from `/api/platform/cloud-costs`, in the platform admin
  only.

If a new dashboard indicator cannot be backed by an existing runtime surface,
add the authoritative backend endpoint first, then render it in the dashboard.
Do not duplicate health calculations in the app.

## Responsive Layout

Admin pages should use dense but readable layouts:

- Header, summary indicators, then task-specific content.
- Cards should stack naturally on narrow screens and use two-to-four columns
  only when the viewport supports it.
- Tables should not be the default for review queues; use responsive rows or
  cards unless comparison across many columns is the primary task.
- Empty states should state the plain fact without explaining internal process.

## Copy

Use plain operator language. Avoid implementation narration, roadmap language,
and self-referential UI copy. Admin pages can name internal systems when that is
the operator's job context, but should still explain the practical consequence:
what needs review, what is blocked, or what is healthy.
