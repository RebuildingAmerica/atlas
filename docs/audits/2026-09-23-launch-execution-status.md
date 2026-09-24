# Atlas launch execution status

September 23, 2026 · branch `chore/atlas-launch-audit`

This is the current implementation and acceptance record for the
[product launch audit](2026-09-23-product-launch-audit.md) and
[billing audit](2026-09-23-billing-readiness.md). Those documents preserve the
observed production snapshot and full critique. This file distinguishes changes
committed in this branch from behavior demonstrated in a deployed release.

## Release decision

**A focused public pilot is conditional. Paid sales and broad national promotion
remain closed.** The repository now contains fixes for several privacy,
purchase-isolation, refund, and journey defects. No production deploy, completed
live payment, genuine signed webhook, or provider-account inspection was
performed in this worktree. A passing unit test does not satisfy those
acceptance gates.

The launch promise remains: a person can find relevant people and organizations
in a named place and issue, inspect evidence, and take a useful next step.
Paying organizers can keep that work; a team can share it without confusing a
public profile claim with a workspace or a purchase.

## What this branch changed

| Outcome                                                 | Implementation evidence                                                                                                                                                                                                                       | Acceptance still needed                                                                                                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correction notes stay private                           | `8417b4fd` separates anonymous status from review evidence.                                                                                                                                                                                   | Deploy and submit a synthetic report; prove anonymous readers cannot retrieve its note and an authorized reviewer can.                                           |
| A member cannot open team billing                       | `8417b4fd` guards the portal at the server.                                                                                                                                                                                                   | Signed-in member, admin, owner, and cross-workspace checks against the deployed app.                                                                             |
| Unapproved offers cannot start a sale                   | `d0fdb5c4` adds an exact production offer allowlist to pricing and Checkout.                                                                                                                                                                  | Inspect the deployed allowlist and checkout flag; verify every visible price and disabled offer.                                                                 |
| A paid session belongs to its saved purchase            | `4ca37d58` matches workspace, product, interval, and session before fulfillment. `25a2543f` aligns the older isolation test.                                                                                                                  | Test-mode purchase, signed webhook, replay, and returning paid access.                                                                                           |
| Delayed and refunded payments do not leave false access | `8417b4fd`, `db9d4a14`, and `9ddfa1d4` gate settlement, attribute refunds, revoke a fully refunded term, and provide a previewable operator command.                                                                                          | Run test-mode async success/failure, cancellation, full refund, retry, and entitlement checks; then inspect live delivery.                                       |
| Visitors can start with search                          | `1a2832aa` moves mobile Browse search ahead of issue panels; `e615149f` makes home People and Organizations shortcuts use type filters.                                                                                                       | Retest with a populated API on physical mobile and complete ten launch questions.                                                                                |
| Mobile map controls remain usable                       | Results start as a compact trigger below search controls; opening them uses a bounded scroll panel. The keyboard skip link opens results, and map controls remain reachable.                                                                  | Recheck with a populated API on a physical phone, including result selection and screen-reader navigation.                                                       |
| Organizers keep work through failures                   | `cd950766` preserves list creation and save retries; `ee9d7fbb` preserves a failed team invitation's address and role.                                                                                                                        | Signed-in, real email, passkey, save, invite acceptance, and recovery journeys.                                                                                  |
| Save intent survives account entry                      | Anonymous Save returns to the same person or organization profile with its list picker open; an incomplete account continues through setup first. The visitor still chooses the destination list before any write.                            | Complete normal magic-link, passkey, setup, and list-save paths on staging in the same browser and across devices.                                               |
| Organizers can assemble briefs from evidence            | A saved-list link opens brief creation with named profiles, their source receipts, and completed research runs. The form derives record IDs and evidence types from selected items and rejects missing sources before submission.             | Signed-in list-to-brief round trip with a populated API, review of source relevance, and reopened brief/export proof.                                            |
| Team access changes get a consequence review            | Member removal and workspace departure now show a named confirmation before access changes. The member roster uses stacked rows below desktop width instead of requiring a 42rem-wide table.                                                  | Test owner/admin/member decisions and cancellation on staging; inspect the roster at 390px with real members and verify keyboard and screen-reader use.          |
| Owners can hand off a workspace                         | An accepted member can become an owner only through an existing owner's explicit confirmation. The outgoing owner can leave once another owner remains; the server checks membership and owner count before either step.                      | Complete invite acceptance, promotion, billing-contact and payment-method review, former-owner departure, and last-owner rejection on a deployed team workspace. |
| Profile evidence makes narrower claims                  | `03857475` distinguishes source dates from confirmation, removes quote attribution from extracted context, and counts unverified sources honestly.                                                                                            | Editorial review of claim-to-source links, duplicated publishers, material edits, and representative profiles.                                                   |
| Rediscovery preserves approved profile facts            | Discovery and registry resolution stage published name, description, contact, and new issue tags with before/after values. A held filing leaves the existing public role evidence intact. Approval checks the current baseline.               | Hosted approval, role-reconciliation process, and PostgreSQL migration proof remain open. Candidate URLs are not claim-level source proof.                       |
| Operators can inspect discovery proposals               | `ebe61081` adds profile identity and candidate URLs to queue items. This branch's admin review page shows current and proposed facts, links to the profile and sources, and requires an explicit source-check acknowledgment before approval. | Rehearse with a real reviewer and representative source-backed proposals on staging; verify permission boundaries and review throughput.                         |
| Related profiles no longer imply a strong relationship  | Profile connections group source-referenced edges as documented relationships and shared signals as related profiles; the relative strength meter is removed.                                                                                 | Verify source anchors and grouping on the hosted profile journey. The API still exposes relative scores, which are ranking data, not relationship proof.         |
| Operators see a more accurate billing preflight         | `58cc819a` checks presence of the production offer allowlist and updates cutover and restricted-key instructions.                                                                                                                             | Verify actual values, Stripe account, catalog, Tax, portal, key permissions, signing secret, and delivered events.                                               |

At 390 × 844 in a local browser, Browse search was measured at y=147.5 after the
layout change; the audit's live production screenshot measured y=2,056.5. The
local app had no API configuration and showed loading results, so that
measurement establishes layout only, not working discovery.

At the same mobile viewport in a local browser, the map's collapsed results
trigger sits below the search/filter controls instead of covering them. Opening
it leaves the lower map controls visible. The local API was unavailable, so this
verifies layout and interaction only, not populated map discovery.

The team roster could not be visually accepted in that local runtime. Local
single-user mode redirected `/organization` to `/discovery`, and the API was
unavailable. The responsive member-row change needs a populated team workspace
at a phone viewport before release.

## Why a Stripe key change is insufficient

The historical production probe opened one live Pro monthly Checkout session. It
did not charge a buyer or establish entitlement, cancellation, or refund.
`pnpm stripe:verify:prod` currently stops at missing `.env.production` values
(`ATLAS_PUBLIC_URL`, Stripe key, signing secret, and catalog) and an unlinked
Vercel project in this worktree. This does **not** prove the deployed production
values are absent or wrong. It means this checkout cannot certify them.

Before opening any offer, a release owner must produce a redacted record tied to
the deployed commit with all of the following:

1. The charge-enabled live Stripe account ID, runtime restricted-key operations,
   catalog object IDs, offered amount/interval/discount combinations, Tax
   configuration, and customer portal behavior.
2. The deployed checkout flag and exact offer allowlist; the webhook URL,
   subscribed events, signing-secret match, authentic delivery, and retry
   reconciliation.
3. A complete test-mode purchase through normal signup, return, entitlement,
   second sign-in, failed/canceled payment, delayed settlement, renewal or pass
   expiry, team seats, cancellation, and refund with access removal.
4. One genuine authorized live buyer payment and receipt on the exact release,
   followed by entitlement and exit-path observation. Do not simulate a live
   charge or treat Checkout creation as this proof.

Use [Stripe billing setup](../deployment/stripe-billing.md) for the verifier,
refund preview, and configuration path. Keep
`ATLAS_BILLING_CHECKOUT_ENABLED=false` and the production offer allowlist empty
until each offered combination passes. Add only accepted offers.

## Remaining work in launch order

| Gate                    | Deliverable and observable pass condition                                                                                                                                                                                                                   | Status                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Release baseline        | Rebase onto current main, resolve drift, run required CI and hosted checks on the exact candidate, deploy to staging, and exercise rollback.                                                                                                                | Fetched remote main; branch is current and linear. Hosted checks, staging deploy, and rollback unverified.                   |
| Private corrections     | Synthetic reporter and moderator journey on staging, with response ownership and urgent escalation.                                                                                                                                                         | Code committed; runtime and staffing unverified.                                                                             |
| Reviewed coverage slice | Name one geography and one or two issues; choose ten real visitor questions; review each returned profile for identity, current work, geography, sources, and safe next step. At least three useful results for each promoted query, or narrow the promise. | No reviewed cohort or query scorecard recorded.                                                                              |
| Public journey          | Mobile browse, result choice, profile evidence, source opening, correction, empty/error states, keyboard and screen-reader essentials on the exact build.                                                                                                   | Search position checked locally; end-to-end outcome unverified.                                                              |
| Organizer journey       | Normal registration, passkey and recovery on physical devices, pending save, list note, reopened work, brief/export, and pricing clarity.                                                                                                                   | Save intent, save failure, and brief selection repaired; complete journey unverified.                                        |
| Team journey            | Workspace creation, invitation send/accept/wrong-account/expiry, roles, shared work, ownership departure, seat totals, and billing authorization.                                                                                                           | Portal guard, invite retention, access-change confirmations, and owner handoff implemented locally; full journey unverified. |
| Paid journey            | Provider inventory and the full matrix above, per enabled offer.                                                                                                                                                                                            | Closed; provider and live lifecycle proof missing.                                                                           |
| Operations              | Name a release owner, editorial reviewer, support inbox owner, refund operator, daily correction/review window, and incident escalation. Record a rehearsal, not only a policy.                                                                             | Ownership and rehearsal not evidenced in this checkout.                                                                      |

The first public release should be a named pilot with reviewed records and
staffed support. The national catalog can remain browsable with honest coverage
limits; national promotion waits for task usefulness across the places claimed.
The paid gate is independent of free browsing. Do not open Team merely because
individual Pro passes: seats, invites, ownership, and shared billing have their
own acceptance rows.

The wrong-account invitation screen now signs out and carries the invitation
through the next sign-in, with a retry if sign-out fails. This is local behavior
proof; acceptance after a real emailed invitation and account switch is still
needed on the deployed release.

Person and organization profiles now put published contact routes and the
Save/source actions directly after identity, ahead of the longer explanation and
evidence sections. This changes the first task a visitor can take; the repeated
summary content lower on the page still needs an editorial pass.

Ownership promotion does not change the Stripe customer's email or payment
method. The outgoing owner sees this before leaving, and a team launch rehearsal
must verify that the remaining owner can open billing, update its contact and
payment method where needed, and receive future receipts.

## Validation of this branch

- After moving profile contact and actions above detailed evidence, the app
  coverage run passed 597 files and 3,884 tests with 100% statements, branches,
  functions, and lines. The two affected profile-page test files passed 45
  cases; app lint, TypeScript, and the production build passed on Node 24.
  Layout and source-opening still need phone and keyboard acceptance on a
  populated deployed profile.
- After repairing invitation account switching, the app coverage run passed 597
  files and 3,882 tests with 100% statements, branches, functions, and lines.
  The invitation page's nine focused tests, app lint, TypeScript, and production
  build passed on Node 24. A real email and signed-in wrong-account round trip
  remain open.
- After enabling owner handoff, the app coverage run passed 597 files and 3,881
  tests with 100% statements, branches, functions, and lines. Five focused
  ownership and membership test files passed 56 cases. App lint, TypeScript, and
  the production build passed on Node 24. Owner promotion and departure still
  need a real team workspace and Stripe billing-contact review on the deployed
  release.
- After adding the team-access consequence review and responsive roster, the app
  coverage run passed 597 files and 3,873 tests with 100% statements, branches,
  functions, and lines. The five affected test files passed 38 cases; app lint,
  TypeScript, and the production build passed. The local runtime could not
  display a populated team workspace, so mobile visual and hosted role
  acceptance remain open.
- After carrying pending Save through sign-in and setup, the app coverage run
  passed 597 files and 3,873 tests with 100% statements, branches, functions,
  and lines. App lint and TypeScript passed. The six affected route and profile
  test files passed 91 cases with 100% coverage for the changed source. A
  real-account return and save still needs a hosted run.
- After replacing raw brief IDs with saved-list evidence selection, the app
  coverage run passed 597 files and 3,866 tests with 100% statements, branches,
  functions, and lines. Focused list-to-brief tests passed 24 cases; the
  production build succeeded on Node 24. This is local behavior proof, not a
  signed-in deployed brief round trip.
- App TypeScript and lint passed for changed files; targeted tests cover the
  edited Browse, save, profile evidence, billing, and team paths. The enforced
  app coverage run passed 593 files and 3,838 tests with 100% statements,
  branches, functions, and lines on the required Node 24 runtime.
- The discovery reviewer work passed the full API run (2,299 passed, six
  skipped), plus 60 focused queue, migration, and discovery tests and 20 OpenAPI
  tests. Its frontend run passed 597 files and 3,855 tests with 100% coverage on
  the final tree. App lint, TypeScript, and the production build passed on
  Node 24.
- After the mobile map adjustment, the frontend run passed 597 files and 3,857
  tests with 100% statements, branches, functions, and lines. App lint,
  TypeScript, and production build passed on Node 24. The 390 × 844 local
  browser check verified the collapsed trigger, opened panel, and unobstructed
  map controls; it did not verify populated map results.
- A focused app run passed 161 files and 1,330 tests across billing,
  organization controls, and catalog components after aligning one stale webhook
  expectation.
- Bootstrap passed 146 tests. Focused API moderation and migration tests passed
  18 cases after a disk-full environment retry. The full API run without
  coverage passed 2,292 tests with six skips and one `aiosqlite` event-loop
  teardown warning in a firehose WebSocket test. After the published-change
  staging implementation, a new full run passed 2,297 tests with six skips; 67
  focused tests, including the added SQLite migration and OpenAPI tests, passed
  afterward. After protecting registry resolution, the full API run passed 2,299
  tests with six skips.
- The default full API coverage gate was attempted, then interrupted after it
  reached only 3% in over eight minutes. It had reported no test failure, but
  this is **not** a coverage pass; the release gate still needs a completed run
  on the candidate.
- Remote `origin/main` was fetched; this branch is ahead, none behind, and has
  no merge commits relative to it.
- No full API coverage-gated run, hosted end-to-end suite, real account/device
  journey, production deployment, or provider payment test was completed here.

The release decision must be updated from observed outcomes. Source code,
documentation, and a commit are reviewable progress, not a launch certificate.
