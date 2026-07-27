# What Kind of Deployment Is This

Status: implemented Date: 2026-07-26

## The problem

Roughly half the recent `fix` commits were deployment-surface bugs. They shared
a cause: nothing said what a deployment was, so every surface reassembled an
answer from overlapping environment variables, and the two halves of the same
deployment could reach different ones.

Two variables carried the question, with non-overlapping value sets:

| variable            | consumers | values                                    |
| ------------------- | --------- | ----------------------------------------- |
| `ATLAS_DEPLOY_MODE` | app + API | `""` · `local` · `staging` · `production` |
| `ENVIRONMENT`       | API only  | `dev` · `staging` · `production`          |

`local` had no API equivalent, `dev` had no app equivalent, and three predicates
read them and disagreed. Evaluated against every real surface, exactly one
disagreed — the default contributor stack:

| surface              | app strict | API strict | agree  |
| -------------------- | ---------- | ---------- | ------ |
| `pnpm dev` (default) | **true**   | **false**  | **no** |
| `pnpm dev:local`     | false      | false      | yes    |
| acceptance suite     | true       | true       | yes    |
| staging / production | true       | true       | yes    |

The app treated default dev as hosted and demanded hosted-grade auth config; the
API skipped validation entirely. That is the surface every contributor and every
agent works in, which is why it generated so many bugs.

## The shape

Atlas runs three ways: the Rebuilding America Project operates it, someone else
operates it as a service for their own users, or someone runs it privately with
no accounts. That is **two independent questions**:

|                           | single-user (no accounts) | multi-user           |
| ------------------------- | ------------------------- | -------------------- |
| **RAP operates**          | —                         | the managed instance |
| **someone else operates** | private instance          | whitelabel service   |

Two booleans, read identically by both runtimes:

```
ATLAS_MULTI_USER   # are there multiple users?
ATLAS_MANAGED  # is the Rebuilding America Project running this?
```

Nothing looks anything up. The questions are the configuration.

`ATLAS_MULTI_USER` decides whether accounts, sign-in, organizations, and billing
exist, and therefore which auth configuration is required.

`ATLAS_MANAGED` decides whether Atlas's own commercial and trust functions
exist: the Stripe catalog and its paid tiers, staff review authority, cloud-cost
posture, the managed PDS. A whitelabel operator administers their own instance
without becoming Atlas staff.

## What fixed the original defect

**Deleting the API's environment exemption**, not adding structure. The API used
to skip all auth validation when `ENVIRONMENT` was dev; the app enforced it
regardless. Requirements now follow from whether there are accounts and nothing
else, with no environment-based exemption anywhere. Local development already
supplied real values — that is why it booted at all — so nothing broke.

## Hardening is not an axis

An earlier draft of this design had a third axis for how strict a deployment
should be, and a named profile selecting a point on all three. Both were
removed.

Strictness is not an independent fact about a deployment; it follows from the
configuration already present. `isHostedAtlasEnv` now asks whether the public
URL is a real origin rather than whether a mode was declared. That is strictly
better than the mode it replaced: the old check only fired for deployments that
knew to name themselves, so a self-hosted instance never received those checks
at all — and the public self-hosting guide told operators to omit the variable,
which disabled the checks for exactly the people who most needed them.

## What else was tried and removed

Recorded because each cost real time and the reasoning generalizes.

- **A named profile** (`ATLAS_PROFILE=production`) selecting a row in a table.
  The names carried no information the two booleans do not, and a name has to be
  kept in sync with what it means.
- **A JSON manifest** (`deploy/profiles.json`) both runtimes read at startup.
  Six records of three enum values that never change at runtime is a constant.
  Putting it in a file required a directory walk (the checkout nests the package
  at `api/atlas`, the image at `/app/atlas`), an override variable for when the
  walk failed, a `COPY` in the Dockerfile, an alias in three build configs, and
  a schema to parse the values back into the types they started as.
  Configuration files earn their keep when values differ per deployment or
  change without a release; these did neither.
- **`requires` / `forbids` lists per profile.** Both runtimes already validate
  every variable they consume, where they consume it, with specific messages. A
  central list duplicated that and forced each runtime to reason about the
  other's configuration.
- **A stored `allowsIdentityHarness` field.** It equalled
  `hardening !== "production"` on every row — a computed value stored as data,
  and a place for the two to disagree.

The general lesson: a duplicate row in a table means a distinction exists in the
product that the model cannot express. Two profiles were byte-identical, which
is how the missing `managed` axis stayed hidden.

## Consequences worth knowing

- Discount review and cloud-cost posture return 404 when `ATLAS_MANAGED` is
  false. A self-hoster has no Atlas discounts to review and no Atlas spend to
  inspect, so those surfaces do not exist for them rather than standing open —
  which is what happened when the only available concept was "this is local,
  allow everything."
- The ATProto proof-lane harness is refused outside staging, ahead of every
  early return, so a seam that accepts unverified identities cannot survive by
  taking a permissive branch.
- The API test suite runs with `ATLAS_MULTI_USER=false` and no auth URLs. A
  populated `ATLAS_AUTH_MEMBERSHIP_URL` sends the suite out over the network,
  which is the failure `74306533` fixed.

## Still open

- The API suite can run against PostgreSQL (`ATLAS_TEST_BACKEND=postgres`) but
  does not yet do so by default. Against a real PostgreSQL the full suite has
  **258 failures**; the catalog domain alone went 87 → 45 → 10 as the row-shape
  and `datetime('now')` fixes landed. What remains is SQLite-only SQL —
  `group_concat`, multi-argument `max()`, `PRAGMA` — mostly in tests and
  migration helpers. Clearing that tail and flipping the variable in CI is the
  last step, and it is the one that stops this defect family recurring.
