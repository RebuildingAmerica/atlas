# Atlas launch execution status

Updated September 27, 2026 · production release `v2026.09.27-4`

This is the current implementation and acceptance record for the
[product launch audit](2026-09-23-product-launch-audit.md) and
[billing audit](2026-09-23-billing-readiness.md). Those documents preserve the
observed September 23 production snapshot and full critique. This file
distinguishes implemented behavior from what the September 27 release actually
demonstrated.

## Release decision

**A Las Vegas public pilot, paid sales, and broad national promotion remain
closed.** The [Las Vegas coverage gate](2026-09-23-las-vegas-coverage-gate.md)
showed no usable promoted transit or housing slice in its September 23 city
snapshot; no later reviewed inventory is recorded here. The repository contains
fixes for several privacy, purchase-isolation, refund, and journey defects.
Release `v2026.09.27-4` deployed those changes, but it did not demonstrate a
completed live payment, genuine signed webhook delivery, provider-account
configuration, or a useful reviewed Las Vegas discovery slice. Passing
deployment checks does not satisfy those acceptance gates.

The launch promise remains: a person can find relevant people and organizations
in a named place and issue, inspect evidence, and take a useful next step.
Paying organizers can keep that work; a team can share it without confusing a
public profile claim with a workspace or a purchase.

## Verified September 27 production baseline

[Release run 36311496613](https://github.com/RebuildingAmerica/atlas/actions/runs/36311496613)
deployed commit `2709f56184d3f8aa45169a5dcf18287abe52a8a0` to the API, PDS, and
Vercel app and promoted the production domains. Full CI passed on that tag,
including browser and Stripe **test-mode** acceptance. Hosted smoke reported 9
passes and 1 skip; the signed-in ATProto identity journey passed once. These
checks establish release and limited hosted behavior, not task success for
public visitors, organizers, or team admins.

The deploy log records `ATLAS_BILLING_CHECKOUT_ENABLED=false`. The hosted job's
live Stripe-session step was skipped by that flag. Paid sales therefore remain
closed, and this release supplies no evidence of a live charge, fulfillment,
renewal, cancellation, or refund. The production test job ran the full API suite
without Python coverage instrumentation after two coverage-enabled release
attempts exceeded the job timeout; pull-request and scheduled CI retain their
coverage configuration. Restore a reliable coverage gate before treating a later
release as fully verified.

The release did not run a rollback drill, physical-mobile or assistive-tech
journey, editorial review of Las Vegas records, private-correction rehearsal, or
team billing-role matrix against the hosted app. Those remain separate gates.

## Implemented outcomes

| Outcome                                                  | Implementation evidence                                                                                                                                                                                                                                                                                                                                                                                   | Acceptance still needed                                                                                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correction notes stay private                            | `8417b4fd` separates anonymous status from review evidence.                                                                                                                                                                                                                                                                                                                                               | Deploy and submit a synthetic report; prove anonymous readers cannot retrieve its note and an authorized reviewer can.                                                                |
| A member cannot open team billing                        | `8417b4fd` guards the portal at the server.                                                                                                                                                                                                                                                                                                                                                               | Signed-in member, admin, owner, and cross-workspace checks against the deployed app.                                                                                                  |
| Unapproved offers cannot start a sale                    | `d0fdb5c4` adds an exact production offer allowlist to pricing and Checkout.                                                                                                                                                                                                                                                                                                                              | Inspect the deployed allowlist and checkout flag; verify every visible price and disabled offer.                                                                                      |
| A paid session belongs to its saved purchase             | `4ca37d58` matches workspace, product, interval, and session before fulfillment. `25a2543f` aligns the older isolation test.                                                                                                                                                                                                                                                                              | Test-mode purchase, signed webhook, replay, and returning paid access.                                                                                                                |
| Delayed and refunded payments do not leave false access  | `8417b4fd`, `db9d4a14`, and `9ddfa1d4` gate settlement, attribute refunds, revoke a fully refunded term, and provide a previewable operator command.                                                                                                                                                                                                                                                      | Run test-mode async success/failure, cancellation, full refund, retry, and entitlement checks; then inspect live delivery.                                                            |
| Visitors can start with search                           | `1a2832aa` moves mobile Browse search ahead of issue panels; `e615149f` makes home People and Organizations shortcuts use type filters.                                                                                                                                                                                                                                                                   | Retest with a populated API on physical mobile and complete ten launch questions.                                                                                                     |
| Bike and bicycle searches reach the same actors          | Public entity and map search now match common bike/bicycle wording in either direction while retaining other search words and place/issue filters. Punctuation is treated as ordinary word separation instead of causing an SQLite query error.                                                                                                                                                           | Deploy the candidate and run Las Vegas visitor questions with reviewed real records. Search wording cannot repair missing local supply.                                               |
| Browse cards make narrower, usable claims                | Cards show the entry type, at most two issue tags, source count/date, and a factual reason for a matching filter. Unsupported lead grades and duplicate source badges are gone. Source links now target real profile sections and disappear when no usable source destination exists.                                                                                                                     | Review representative populated cards on a phone, including long descriptions, missing sources, and records without slugs.                                                            |
| Mobile map controls remain usable                        | Results start as a compact trigger below search controls; opening them uses a bounded scroll panel. The keyboard skip link opens results, and map controls remain reachable.                                                                                                                                                                                                                              | Recheck with a populated API on a physical phone, including result selection and screen-reader navigation.                                                                            |
| Organizers keep work through failures                    | `cd950766` preserves list creation and save retries; `ee9d7fbb` preserves a failed team invitation's address and role.                                                                                                                                                                                                                                                                                    | Signed-in, real email, passkey, save, invite acceptance, and recovery journeys.                                                                                                       |
| Save intent survives account entry                       | Anonymous Save returns to the same person or organization profile with its list picker open; an incomplete account continues through setup first. The visitor still chooses the destination list before any write.                                                                                                                                                                                        | Complete normal magic-link, passkey, setup, and list-save paths on staging in the same browser and across devices.                                                                    |
| Organizers can assemble briefs from evidence             | A saved-list link opens brief creation with named profiles, their source receipts, and completed research runs. The form derives record IDs and evidence types from selected items and rejects missing sources before submission.                                                                                                                                                                         | Signed-in list-to-brief round trip with a populated API, review of source relevance, and reopened brief/export proof.                                                                 |
| Team access changes get a consequence review             | Member removal and workspace departure now show a named confirmation before access changes. The member roster uses stacked rows below desktop width instead of requiring a 42rem-wide table.                                                                                                                                                                                                              | Test owner/admin/member decisions and cancellation on staging; inspect the roster at 390px with real members and verify keyboard and screen-reader use.                               |
| Owners can hand off a workspace                          | An accepted member can become an owner only through an existing owner's explicit confirmation. The outgoing owner can leave once another owner remains; the server checks membership and owner count before either step.                                                                                                                                                                                  | Complete invite acceptance, promotion, billing-contact and payment-method review, former-owner departure, and last-owner rejection on a deployed team workspace.                      |
| Profile evidence makes narrower claims                   | `03857475` distinguishes source dates from confirmation, removes quote attribution from extracted context, and counts unverified sources honestly.                                                                                                                                                                                                                                                        | Editorial review of claim-to-source links, duplicated publishers, material edits, and representative profiles.                                                                        |
| Source links do not masquerade as claim review           | Profile and map identity tiers no longer infer corroboration from two source hosts. Summary, place, and issue claims carry no source IDs or claim dates until a reviewer links evidence; contact details retain only explicit source links. The profile labels this as claim support, and the map legend omits corroboration. Public-directory source-backed totals continue to count records with links. | Build and rehearse claim-level review, then visually inspect representative profiles and map points on the deployed app. Linked source packets still require a human relevance check. |
| Source dates no longer borrow crawl timestamps           | Search, detail, map, saved exports, MCP records, profile history, and browse cards now use a source's published date only. Undated evidence stays undated; the stale-source review queue includes records with no dated source.                                                                                                                                                                           | Review published and undated profiles on the deployed app, then verify the reviewer queue against real source records.                                                                |
| Rediscovery preserves approved profile facts             | Discovery and registry resolution stage published name, description, contact, and new issue tags with before/after values. A held filing leaves the existing public role evidence intact. Approval checks the current baseline.                                                                                                                                                                           | Hosted approval, role-reconciliation process, and PostgreSQL migration proof remain open. Candidate URLs are not claim-level source proof.                                            |
| Operators can inspect discovery proposals                | `ebe61081` adds profile identity and candidate URLs to queue items. This branch's admin review page shows current and proposed facts, links to the profile and sources, and requires an explicit source-check acknowledgment before approval.                                                                                                                                                             | Rehearse with a real reviewer and representative source-backed proposals on staging; verify permission boundaries and review throughput.                                              |
| Editors can recover missing Las Vegas website contacts   | The review page can stage a linked HTTPS organization-site URL when it belongs to only one public Las Vegas organization and the contact website is empty. Shared directory pages and ambiguous sites are excluded; approval rechecks the source link and published baseline. No contact field changes during scanning.                                                                                   | Deploy and run the scan with an authorized editor, inspect each proposed site for current ownership and a usable public action, approve or reject it, then verify the public profile. |
| Related profiles no longer imply a strong relationship   | Profile connections group source-referenced edges as documented relationships and shared signals as related profiles; the relative strength meter is removed.                                                                                                                                                                                                                                             | Verify source anchors and grouping on the hosted profile journey. The API still exposes relative scores, which are ranking data, not relationship proof.                              |
| Operators see a more accurate billing preflight          | `58cc819a` checks presence of the production offer allowlist and updates cutover and restricted-key instructions. The verifier now distinguishes missing local proof from missing deployed configuration and does not suggest creating a new key as the default remedy.                                                                                                                                   | Verify actual values, Stripe account, catalog, Tax, portal, key permissions, signing secret, and delivered events.                                                                    |
| Enabled billing cannot start a partial production deploy | The production workflow checks Vercel Production setting names before deploying the API or PDS. It requires the key, catalog, signing secret, and offer allowlist when checkout is enabled; malformed metadata and missing names stop the workflow without reading values.                                                                                                                                | Rehearse the release workflow on the exact candidate. Setting presence does not prove a live account, correct values, webhook delivery, or a completed payment.                       |

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
did not charge a buyer or establish entitlement, cancellation, or refund. `app/`
is now locally linked to the existing Atlas Vercel project. Read-only Vercel
Production metadata confirms the Stripe key, signing secret, catalog, and Atlas
public URL variable names are present; their values were not read. The
`ATLAS_BILLING_ALLOWED_OFFERS` variable required by this branch's paid release
gate was absent at the September 23 inspection. The September 27 production
workflow recorded the GitHub checkout flag as `false`; it did not inspect the
live offer allowlist or Stripe object values. `pnpm stripe:verify:prod` still
cannot inspect the live catalog because this checkout has no `.env.production`
verification inputs. These facts neither prove nor disprove the deployed key's
validity, webhook delivery, or ability to charge.

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

| Gate                    | Deliverable and observable pass condition                                                                                                                                                                                                                   | Status                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release baseline        | Run required CI and hosted checks on the exact candidate, deploy, and exercise rollback.                                                                                                                                                                    | `v2026.09.27-4` passed CI, production deployment, hosted smoke, and hosted identity. Python coverage was omitted from this release test job; a rollback drill remains unverified.                                                                                                                               |
| Private corrections     | Synthetic reporter and moderator journey on staging, with response ownership and urgent escalation.                                                                                                                                                         | Code committed; runtime and staffing unverified.                                                                                                                                                                                                                                                                |
| Reviewed coverage slice | Name one geography and one or two issues; choose ten real visitor questions; review each returned profile for identity, current work, geography, sources, and safe next step. At least three useful results for each promoted query, or narrow the promise. | [Las Vegas](2026-09-23-las-vegas-coverage-gate.md) is the home-market gate. Current city records have zero public-transit entries and no listed website or email across transit/housing candidates. Acquire and review useful local supply before promoting a pilot. Seattle remains comparative evidence only. |
| Public journey          | Mobile browse, result choice, profile evidence, source opening, correction, empty/error states, keyboard and screen-reader essentials on the exact build.                                                                                                   | Search position checked locally; end-to-end outcome unverified.                                                                                                                                                                                                                                                 |
| Organizer journey       | Normal registration, passkey and recovery on physical devices, pending save, list note, reopened work, brief/export, and pricing clarity.                                                                                                                   | Save intent, save failure, and brief selection repaired; complete journey unverified.                                                                                                                                                                                                                           |
| Team journey            | Workspace creation, invitation send/accept/wrong-account/expiry, roles, shared work, ownership departure, seat totals, and billing authorization.                                                                                                           | Portal guard, invite retention, access-change confirmations, and owner handoff implemented locally; full journey unverified.                                                                                                                                                                                    |
| Paid journey            | Provider inventory and the full matrix above, per enabled offer.                                                                                                                                                                                            | Closed; provider and live lifecycle proof missing.                                                                                                                                                                                                                                                              |
| Operations              | Name a release owner, editorial reviewer, support inbox owner, refund operator, daily correction/review window, and incident escalation. Record a rehearsal, not only a policy.                                                                             | Ownership and rehearsal not evidenced in this checkout.                                                                                                                                                                                                                                                         |

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

Person and organization profiles now put source inspection, confirmed website
visits, and Save directly after identity, ahead of contact details and longer
evidence sections. A website becomes the primary action only when a linked
source supports it; otherwise source inspection remains first. The hero says
where a record is listed without inferring current activity from its geography.
The repeated “At a glance” and “Why this matters” panels have been removed from
both actor pages. Those panels restated the hero's description, place, contact,
and source count, and inferred impact from issue tags. A visitor now reaches
unique source context or the record's evidence directly after the primary
actions. A synthetic 390-pixel local browser check showed the action strip in
the first viewport; editorial review is still needed for the underlying work
descriptions and source relevance.

Contact actions now require linked-source support for the listed website or
email. Unreviewed or unsupported values remain visible as text with an explicit
status; phone numbers remain text because the public record has no phone-support
signal. Invalid website addresses cannot become outbound links. The profile,
entry detail, and map call the Atlas trust tier an identity review, not a review
of every profile claim. Record-history dates now describe listing and record
updates without implying that a source or representation was verified on that
date. This limits the claims made to visitors; it does not replace editorial
review of individual contact routes.

Ownership promotion does not change the Stripe customer's email or payment
method. The outgoing owner sees this before leaving, and a team launch rehearsal
must verify that the remaining owner can open billing, update its contact and
payment method where needed, and receive future receipts.

## Validation of this branch

- The production billing verifier's local/hosted distinction passed 147
  bootstrap tests. Read-only Vercel metadata and the repository checkout flag
  were checked on September 23; no provider value, payment, or webhook was
  inspected. The verifier still exits nonzero because local live inputs and the
  hosted offer allowlist are missing.
- The pre-deployment billing check passed 71 deployment tests and `actionlint`.
  Against current read-only Vercel Production metadata, it exits nonzero for the
  absent `ATLAS_BILLING_ALLOWED_OFFERS` setting. It runs before API and PDS
  deployment when checkout is enabled; no provider values were read, and no
  production workflow was launched.
- The profile hierarchy change passed 594 frontend test files and 3,864 tests
  with 100% statements, branches, functions, and lines. ESLint and TypeScript
  passed. A seeded local mobile and desktop browser check showed the action
  strip immediately after the hero. Seed records are synthetic, so this is
  layout evidence rather than live profile or data acceptance.
- The profile contact and identity-label correction passed 594 frontend test
  files and 3,872 tests with 100% statements, branches, functions, and lines.
  Contact and map assertions were exercised red-green. ESLint, TypeScript, and
  the Node 24 production build passed. Live contact ownership, human review
  history, and deployed profile behavior remain unverified.
- The bike/bicycle search regression passed its red-green check, then 50 nearby
  catalog, API, map, and PostgreSQL SQL-shape tests passed. Python formatting,
  Ruff, and mypy passed. The deployed Seattle scorecard has not been rerun;
  current read-only API requests from this environment received HTTP 403, which
  does not establish a customer-facing outage.
- The claim-support correction passed 29 focused API trust and map tests and 38
  profile and map component tests after red-green checks. A wider directory and
  API run exposed a source-backed summary count coupled to the summary-claim
  field; the count now uses linked record sources while claim support remains
  unreviewed. The final broader API slice passed 100 cases; Python formatting,
  Ruff, and mypy passed. The app passed 596 files and 3,878 tests with 100%
  statements, branches, functions, and lines; lint, TypeScript, and the Node 24
  production build passed. No hosted profile review has been performed on this
  change, and the full API coverage gate remains open.
- The publication-date correction passed 596 frontend test files and 3,877 tests
  with 100% statements, branches, functions, and lines. App lint, TypeScript,
  and the Node 24 production build passed. Python formatting, Ruff, and mypy
  passed; 137 changed API and review-queue tests passed. A full API run without
  coverage was interrupted after 128 tests passed so the review-queue behavior
  could be corrected; neither that run nor focused tests constitute a completed
  API coverage gate. Deployed source and reviewer journeys remain unverified.
- After narrowing the browse cards and repairing source destinations, four
  focused catalog test files passed 75 cases. A further regression test caught
  an initiative mislabeled as a verified person and passed after the fix. The
  final app coverage run passed 596 files and 3,875 tests with 100% statements,
  branches, functions, and lines; lint, TypeScript, and the Node 24 production
  build also passed. Populated mobile browsing and source navigation remain
  hosted acceptance gates.
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
