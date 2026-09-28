# Atlas launch execution status

Updated September 28, 2026 · production release `v2026.09.28-1`

This is the current implementation and acceptance record for the
[product launch audit](2026-09-23-product-launch-audit.md) and
[billing audit](2026-09-23-billing-readiness.md). Those documents preserve the
observed September 23 production snapshot and full critique. This file
distinguishes implemented behavior from what the current release actually
demonstrated.

## Release decision

**A Las Vegas public pilot, paid sales, and broad national promotion remain
closed.** The [Las Vegas coverage gate](2026-09-23-las-vegas-coverage-gate.md)
showed no usable promoted transit or housing slice in its September 23 city
snapshot; no later reviewed public inventory is recorded here. The repository
contains fixes for several privacy, purchase-isolation, refund, and journey
defects. Release `v2026.09.28-1` deploys the latest Team sharing and workspace
setup fixes. The last recorded
[protected runtime Stripe inventory, on v22](https://github.com/RebuildingAmerica/atlas/actions/runs/36375819749)
passed its live key, charge-enabled account, Tax status, and catalog
identifiers; the Atlas portal configuration, four webhook subscriptions, and
offer allowlist were missing. No later inventory or completed live payment,
signed webhook delivery, or useful reviewed Las Vegas discovery slice has been
demonstrated. Checkout remains disabled. Passing deployment checks does not
satisfy those acceptance gates.

The
[September 27 Las Vegas editorial packet](2026-09-27-las-vegas-editorial-packet.md)
identifies candidate organizations, official next steps, and ten visitor
questions. The September 27 public catalog was checked for exact-name
duplicates, and one existing NAACP branch record was identified for an update
instead of a new profile. The candidates have not been published into Atlas or
exercised as a visitor journey. The Las Vegas pilot gate remains closed.

The launch promise remains: a person can find relevant people and organizations
in a named place and issue, inspect evidence, and take a useful next step.
Paying organizers can keep that work; a team can share it without confusing a
public profile claim with a workspace or a purchase.

## Organizer output change on `main`, not in production

Commit `aaea9a5c` makes failed saved-list CSV and JSON downloads and denied copy
actions explain the failure to the organizer. A local browser test first
reproduced silent failures, then verified a visible retry message at the
organizer's scroll position and a downloaded CSV containing the saved person and
source URL. The full local browser suite passed 34 journeys and the repository
quality suite passed 33 tasks at its required coverage. The Team capability in
that browser test was granted only in isolated local data; this is not a
purchase or hosted customer acceptance.

[Staging run 36421217945](https://github.com/RebuildingAmerica/atlas/actions/runs/36421217945)
passed its test, quality, secrets, and browser jobs but failed hosted smoke on
both attempts. The first timed out on a public person lookup and API health; the
second timed out on a public organization lookup. The app-only change did not
deploy a new staging API and hosted identity was skipped. A separate read-only
check at 12:30 UTC on September 28 received HTTP 200 from direct staging API
health and one-record person and organization requests in under 1.2 seconds. The
available Vercel staging logs contained no completed `/api/entities` response
for the timed-out hosted requests. The runner network, edge, and app proxy
remain possible causes; the exact layer is unknown. **Do not call `aaea9a5c`
production behavior or release it from this failed staging gate.**

## Current production release `v2026.09.28-1`

[Release run 36416409020](https://github.com/RebuildingAmerica/atlas/actions/runs/36416409020)
passed full release CI and browser acceptance, deployed commit
`f4e49659bf1cd0d728fd1d9ca06d284e02b2f0fc` to the API, PDS, and Vercel app,
promoted the production domains, and passed hosted public smoke and signed-in
identity checks. The checkout job succeeded only because its live session step
was **skipped** while sales remain closed. This run did not move money, fulfill
an entitlement, or prove a visitor's or organizer's complete product task. The
same commit's
[staging run 36415678992](https://github.com/RebuildingAmerica/atlas/actions/runs/36415678992)
deployed the API and passed hosted smoke and identity checks; its manual-release
profile skipped the full CI jobs.

The release removes the API's 60-second membership cache, so a changed Team role
or product is checked on the next protected request. Concurrent sign-in requests
now reuse a newly created personal workspace instead of creating suffix-named
duplicates. A local two-account browser test exercised an owner creating a
sourced list, upgrading to Team in isolated test data, inviting a colleague,
sharing the list, and seeing the colleague's note after acceptance and passkey
enrollment. It deliberately grants the Team entitlement in local test data and
does **not** prove a Stripe purchase or the same journey against the hosted
production app. The local full browser acceptance suite passed 33 tests. The
production browser acceptance job also passed, including a synthetic Las Vegas
editorial intake; it does not establish official-source review or publication of
a real pilot profile.

**GO/NO-GO:** This is a deployed software release, not pilot acceptance. The Las
Vegas packet's candidates remain unreviewed and unpublished in Atlas, its ten
visitor questions have not passed against production mobile, and the production
billing lifecycle remains unproven. Keep promoted Las Vegas coverage and new
paid sales closed. The next customer-facing work is to review and publish the
packet's existing-record correction and qualified candidates, then run the ten
questions on a phone; payment work must separately establish the Atlas portal,
webhook events, offer allowlist, and an authorized buyer's purchase-to-exit
journey.

## Prior production release `v2026.09.27-22`

[Release run 36373868581](https://github.com/RebuildingAmerica/atlas/actions/runs/36373868581)
passed full CI, deployed commit `baa1d909845b9c02691664879b5784da88cd37bb`, and
passed hosted public smoke and signed-in identity checks. The hosted checkout
job completed, but its live-session step was skipped because new sales are
closed. This release includes the cumulative-full-refund entitlement fix, the
mobile map-count correction, and bounded hosted public-page checks. The refund
correction has a passing unit regression, but an actual refunded customer and
signed provider event have not been demonstrated on this release. The
[v22 read-only billing inventory](https://github.com/RebuildingAmerica/atlas/actions/runs/36375819749)
returned **NO-GO** at 03:59 UTC on September 28: runtime key, charge capability,
Tax, and catalog IDs passed; the Atlas portal was absent, the webhook missed
both async-payment and both refund events, the offer allowlist was absent, and
checkout was closed. It did not move money or modify provider settings.

Commit `aed7acb2` follows this production tag on `main`. It replaces indefinite
loading on the profiles overview with a visible retry and avoids unused catalog
requests on scoped pages. Local app tests passed 601 files and 3,941 tests at
100% coverage; the repository pre-push gate passed 33 of 33 tasks. It is **not
part of v22** and is not recorded as production behavior.

Main commit `50c6a6e2` bounds public API retries to one automatic retry and then
shows a manual recovery action for degraded profile, place, directory, Firehose,
search, map, and profile-network reads. A failed network lookup is no longer
displayed as an empty relationship list; organization-related people also report
failure rather than silently disappearing. The full app suite passed 601 files,
3,951 tests, and 100% statement, branch, function, and line coverage. This
change has not been released to production or verified there. The first staging
run timed out on two hosted checks; the later
[main staging run 36379059918](https://github.com/RebuildingAmerica/atlas/actions/runs/36379059918)
passed CI, 30 browser acceptance checks, and hosted smoke on commit `849b5bea`.
Staging success is not a production acceptance result.

Main commit `9e6ce510` records the exact identity, work, place, issue,
official-action, and citation facts submitted for a held organization. Approval
rejects any candidate whose facts or source notes changed before review. Older
held candidates without a snapshot must be restaged. Commit `849b5bea` shows a
candidate's citation note once in the review card. The 28 editorial-intake tests
passed locally, and main staging run 36379059918 passed remote API coverage and
browser acceptance. No Las Vegas candidate was approved or published by these
checks. A local full-coverage attempt ran out of disk space before completion.

The review queue now allows editorial approval to remove issue tags from an
existing public profile after checking its original tag set. The editor screen
can search for a published organization, load its current facts, and submit a
source-backed correction without changing the public profile before approval.
New official-site citations become public only on approval. A synthetic local
browser journey verified search, submission, unchanged public facts, approval,
and the corrected public description and issue tag. The full local API suite
passed 2,382 tests and 100% coverage; the app suite passed 3,959 tests and 100%
coverage. These checks do not establish a hosted editor session or a published
Las Vegas correction. The existing NAACP branch record still needs its exact
source-backed correction staged, reviewed, and published in production.

## Prior production release `v2026.09.27-21`

[Release run 36370886771](https://github.com/RebuildingAmerica/atlas/actions/runs/36370886771)
passed full CI, deployed commit `3139be61b687d04467284cd6923fabc7295c7b17`, and
passed hosted public smoke and signed-in identity checks. The hosted checkout
job completed, but its live-session step was skipped because the sale flag is
`false`. This release includes the source-note review card and guarded editorial
intake, but there is still no hosted editor journey or published reviewed Las
Vegas slice. The prior v20 release stopped at secret scanning and did not
deploy.

The exact-release
[read-only billing inventory](https://github.com/RebuildingAmerica/atlas/actions/runs/36372295127)
returned **NO-GO**. The deployed runtime passed key, charge-enabled account,
Tax, and catalog-ID checks. Portal configuration is missing; the webhook is
missing the two async-payment and two refund events; the offer allowlist is
absent. The [dated acceptance matrix](2026-09-28-billing-readiness-v21.md)
classifies every purchase and exit journey. Commit `b4ee7eed` fixes cumulative
partial-refund revocation in source and is not part of v21; it was deployed in
v22.

## Staged Las Vegas editorial intake

The current `main` release candidate adds a guarded organization-intake form to
the discovery review page. An editor enters an organization name, description,
geographic scope, issue areas, an official source with the claim it supports,
and an official next step. The API checks HTTPS sources, a shared official site,
taxonomy, place, exact-name and linked-source duplicates; it stores the profile
as **inactive** with its citations and a pending review item in one transaction.
The review card shows the proposed facts, cited URLs, and the recorded claim
each cited page supports. A separate editorial decision is required to make the
profile public, and approval refuses a candidate whose cited source was
unlinked. These are local implementation and test results, not hosted editorial
or visitor acceptance.

A local Chromium acceptance test now signs in as an editor, stages a Las Vegas
organization, confirms it is absent from public search while held, checks the
recorded source note in the private review card, approves it, and opens the
published profile. The test uses synthetic `example.org` pages; it proves the
local product path, not the packet's real organizations or hosted operation. The
app's full local suite passed 601 files and 3,941 tests at 100% statement,
branch, function, and line coverage. Forty-seven focused API review and intake
tests passed. The source-note mapping also rejects unsafe evidence URLs and
keeps a homepage note attached after URL normalization. Earlier staging runs
[36366344590](https://github.com/RebuildingAmerica/atlas/actions/runs/36366344590)
and
[36367814854](https://github.com/RebuildingAmerica/atlas/actions/runs/36367814854)
stopped before deployment on one uncovered Python line and one uncovered app
branch, respectively; regression cases for both are now on `main`. No hosted
editor session or real Las Vegas candidate publication has been verified.

A read-only inventory of all 1,403 production public records across 15 API pages
found no exact-name match for the seven proposed new organization names in the
editorial packet. `NAACP Las Vegas Branch #1111` already exists and must be
updated on that record; PedSafe Vegas remains held for entity-type review. Fuzzy
and linked-source duplicates, source claims, and useful actions still require a
human editorial decision. No production profile was written during this
inventory.

A later read-only detail scan of all 30 public Nevada organization profiles
found one candidate official-site domain already linked: the existing NAACP Las
Vegas branch. The other packet domains did not appear in that Nevada slice. This
does not clear out-of-state records or near-name duplicates, and it did not
publish or edit a profile.

For the initial intake change at `2743c8c6`, local acceptance passed 601 test
files and 3,935 tests with 100% statement, branch, function, and line coverage,
plus lint, TypeScript, and a production build on Node 24. The full API run
passed 2,361 tests with six skips; its initial coverage report was 99.99%
because one new approval guard lacked a regression case. Two additional cases
passed and appended coverage on the unchanged application code, bringing
combined API statement and branch coverage to 100%. Python formatting, Ruff, and
mypy passed. The complete API coverage command was not rerun in one invocation
after those final two tests.
[Staging run 36362632652](https://github.com/RebuildingAmerica/atlas/actions/runs/36362632652)
passed CI, API deployment, and hosted checks on commit `2743c8c6`. No hosted
editor or visitor journey was verified, and this intake is not in production.

## Billing portal setup in the next release candidate

Stripe's portal-session API uses an account-default configuration when Atlas
does not specify one. The v19 live account has no default configuration, so a
buyer could be charged without a working self-service cancellation or invoice
path. The current billing change makes bootstrap create or reuse a tagged
Atlas-specific configuration, syncs its ID to the app, opens portal sessions
with that ID, and checks that exact configuration for live mode, invoice
history, payment-method updates, and end-of-term cancellation. Portal plan
changes are disabled so customers cannot enter an unreviewed offer. Production
preflight now requires the setting whenever checkout is enabled. The existing
bootstrap webhook path can update an endpoint to the eight canonical events. The
app passed 601 test files and 3,939 tests with 100% statement, branch, function,
and line coverage. Focused bootstrap and billing preflight tests, lint, and app
TypeScript checks passed. A fresh worktree dependency install and production
build were not completed because the host ran out of disk space; release CI
remains necessary. No live Stripe object has been changed or verified by this
branch. The portal, webhook delivery, offer allowlist, genuine buyer payment,
entitlement, cancellation, and refund gates remain open. Checkout remains
closed.

## Verified September 27 production baseline

[Release run 36319794580](https://github.com/RebuildingAmerica/atlas/actions/runs/36319794580)
deployed commit `3905eee9fc42e3b52face96deb7152242adf1884` to the API, PDS, and
Vercel app and promoted the production domains. Full release CI passed,
including browser and Stripe **test-mode** acceptance. Hosted smoke and the
signed-in ATProto identity journey passed. These checks establish release and
limited hosted behavior, not task success for public visitors, organizers, or
team admins.

The same commit passed a manually dispatched
[staging deployment and hosted checks](https://github.com/RebuildingAmerica/atlas/actions/runs/36318956086)
on attempt 2. The first hosted identity attempt timed out after reaching the
test provider's authorization URL without a callback; the retry completed the
journey. This is a test reliability concern to investigate, not evidence that
the first attempt passed.

The deploy log records `ATLAS_BILLING_CHECKOUT_ENABLED=false`. The hosted job's
live Stripe-session step was skipped by that flag. Paid sales therefore remain
closed, and this release supplies no evidence of a live charge, fulfillment,
renewal, cancellation, or refund. Production CI ran the full API suite without
Python coverage instrumentation. The coverage-enabled staging suite had stalled
beyond 30 minutes on the prior attempt; the staging release profile now also
omits coverage, although the manual staging run did not rerun the test job.
Pull-request and scheduled CI retain their coverage configuration, but no recent
successful coverage run is recorded here. Restore a reliable coverage gate
before treating a later release as fully verified.

The read-only
[Production billing inventory run 36316296989](https://github.com/RebuildingAmerica/atlas/actions/runs/36316296989)
completed against the prior release and intentionally exited nonzero for
**NO-GO**. Vercel Production metadata confirms `STRIPE_API_KEY`,
`STRIPE_ATLAS_CATALOG`, and `STRIPE_WEBHOOK_SECRET` are configured by name,
while `ATLAS_BILLING_ALLOWED_OFFERS` is absent. Vercel does not expose sensitive
variable values to this CLI job, so the deployed key's validity and mode,
charge-enabled account, catalog and webhook objects, Tax, portal, signed
delivery, runtime write permissions, and payment lifecycle remain unverified.
The inventory did not change settings or move money.

The release did not run a rollback drill, physical-mobile or assistive-tech
journey, editorial review of Las Vegas records, private-correction rehearsal, or
team billing-role matrix against the hosted app. Those remain separate gates.

This release includes a catalog API change so generic entity creation defaults
to private workspace visibility. Public release requires the separate
source-checked workspace publish action. Generic edits and deletion now require
a matching ownership row; an organization cannot rewrite or remove a legacy
public record just because that record has no owner. These protections have
local endpoint regression tests but still need a hosted authorization check.
They do not review the relevance of linked sources or govern every later edit to
a published owned record; those editorial controls remain open.

## Prior production release `v2026.09.27-7`

[Staging run 36322397000](https://github.com/RebuildingAmerica/atlas/actions/runs/36322397000)
passed change-scoped CI, deployed the API, and passed hosted smoke for commit
`b274c1c8b1fc9e6d146243962002cb74bab0ba14`. The
[production run 36322916591](https://github.com/RebuildingAmerica/atlas/actions/runs/36322916591)
passed full release CI, deployed the API, PDS, and Vercel app, promoted the
production domains, and passed hosted smoke. Production billing preflight
reported that checkout is closed; the live Stripe-session step was skipped.

The production hosted ATProto identity journey failed on both the original run
and its failed-job retry. In both traces, owner identity setup, delegation, and
removal completed, but the final sign-in reached the internal provider
authorization request without receiving a callback within 20 seconds. The
request had not completed in either trace. Diagnose that hosted redirect and
rerun the full journey before calling this release fully verified. This failure
does not establish a new regression in the published-entry API change, but it
does leave signed-in production acceptance open.

This release stages owner-proposed changes to published names, descriptions,
places, contact details, and websites for editorial approval through either
owner-write endpoint. It leaves the public record unchanged while review is
pending, blocks owner self-verification and direct public deletion, checks
ownership again at approval, and refreshes map coordinates after an approved
place change. The API suite passed 2,326 tests with six skips locally, and the
release CI test job passed. A hosted owner-to-reviewer approval journey and a
reviewable public-removal request are still needed.

## Prior production release `v2026.09.27-8`

The
[staging run 36324925366](https://github.com/RebuildingAmerica/atlas/actions/runs/36324925366)
passed CI, hosted smoke, and the complete signed-in ATProto identity journey for
commit `3ea07697c6089160f91c3c62096ca2421116c2d0`. The
[production run 36325612236](https://github.com/RebuildingAmerica/atlas/actions/runs/36325612236)
passed full release CI, deployed the API, PDS, and Vercel app, promoted the
production domains, and passed hosted smoke and the same identity journey. The
v7 identity failure was caused by the hosted test intercepting the sign-in
navigation and fulfilling it with a fetched `302`; headless Chromium left the
provider request pending. Continuing the original request lets the browser
follow the server redirect and keeps the test credential off later redirect
requests. A direct browser reproduction and the staging and production journeys
verified the fix.

Production checkout remains closed. The hosted checkout job succeeded, but its
live Stripe-session step was skipped by the flag. The release did not prove a
charge, entitlement, cancellation, or refund; the paid-launch gate remains
closed. No hosted owner-to-reviewer approval, Las Vegas coverage slice, rollback
drill, or physical-device journey has been recorded for this release.

## Prior production release `v2026.09.27-9`

Commit `dbb81144d660b7b5d6fea7e69f2681ddaeb033e7` prevents a reviewer from
approving a staged public-profile change after its candidate source URL has been
removed from that profile. The API returns a conflict, leaves the public fact
unchanged, and keeps the proposal pending for review. The new regression test
reproduced an incorrect approval before the fix. Locally, the full API suite
passed 2,327 tests with six skips without coverage; Ruff and mypy passed. The
coverage-enabled local quality gate stalled during Atlas import, so the push
bypassed that local hook. This is an unresolved validation limit, not a passing
coverage result.

The
[staging run](https://github.com/RebuildingAmerica/atlas/actions/runs/36329579250)
and
[production run](https://github.com/RebuildingAmerica/atlas/actions/runs/36330214791)
passed release CI and hosted smoke and identity checks on that exact commit.
Production deployed the API, PDS, and Vercel app and promoted the domains.
Release CI omitted Python coverage. The hosted checkout job passed its enabled
checks, but the live Stripe-session step was **skipped** because checkout is
disabled. No hosted reviewer approval or live payment lifecycle was proven.

The read-only
[billing inventory for this exact release](https://github.com/RebuildingAmerica/atlas/actions/runs/36331147811)
returned **NO-GO**: checkout is closed and `ATLAS_BILLING_ALLOWED_OFFERS` is
absent in Vercel Production. The Stripe key, catalog, and webhook secret are
configured by name, but sensitive values were unreadable in that inspection. The
live account, catalog, webhook delivery, Tax, portal, permissions, and purchase,
entitlement, cancellation, and refund lifecycle remain unverified. This
inventory changed no settings and moved no money.

## Prior production release `v2026.09.27-10`

Commit `615e0f03617384d6df71f03c08919dc452eb824a` restores Python statement and
branch coverage to staging and production release CI. The API test command
preloads `probablepeople` before coverage starts in each worker; its generated
name-ratio table had made coverage-instrumented startup take minutes per worker.
Regression tests now exercise malformed and stale review proposals, approval
races, unpublished owned profiles, and unchanged rediscovery. Locally, the full
repository quality command and normal pre-push gate passed; the API suite passed
2,341 tests with six skips at 100% coverage.

The
[staging run](https://github.com/RebuildingAmerica/atlas/actions/runs/36332872273)
and
[production run](https://github.com/RebuildingAmerica/atlas/actions/runs/36333668878)
passed on that exact commit. Both PostgreSQL-backed API jobs passed 2,347 tests
at 100% statement and branch coverage, alongside browser acceptance, contract,
secrets, and other required release checks. Staging deployed the API and passed
hosted smoke. Production deployed the API, PDS, and Vercel app, promoted the
domains, and passed hosted smoke and signed-in identity. The public app returned
HTTP 200 and the API health endpoint returned `{"status":"ok"}` after release.
No rollback drill or hosted owner-to-reviewer approval is recorded.

The hosted checkout job succeeded, but **its live Stripe-session step was
skipped** because checkout is disabled. The read-only
[billing inventory for v10](https://github.com/RebuildingAmerica/atlas/actions/runs/36334753045)
returned **NO-GO**: Production checkout is closed and
`ATLAS_BILLING_ALLOWED_OFFERS` is absent. The Stripe key, catalog, and webhook
secret are configured by name, but their sensitive values were unreadable in
that inspection. Charge-enabled account, catalog, webhook delivery, Tax, portal,
runtime permissions, and the payment and refund lifecycle remain unverified. The
inventory changed no settings and moved no money.

## Prior production release `v2026.09.27-11`

Commit `64aa981001d51290df676dc08513576bc2310586` changes the public person and
organization profile order. Contact routes and issue focus now lead into
openable source records; statistics, trust diagnostics, and record history
follow. Source context appears once in the source panel and is labeled as
context rather than a direct quotation. The panel drops repeated headings and
decorative source counts, chooses a dated publication ahead of an undated later
ingestion, and withholds “Inspect sources” when no source is linked. A
first-listed date no longer creates an otherwise empty organization contact
panel.

The app suite passed 3,879 tests at 100% statement, branch, function, and line
coverage locally. The normal pre-push gate passed all 33 repository quality
tasks.
[Staging run 36336301622](https://github.com/RebuildingAmerica/atlas/actions/runs/36336301622)
passed CI, browser acceptance, and hosted smoke on the exact commit.
[Production run 36336585815](https://github.com/RebuildingAmerica/atlas/actions/runs/36336585815)
passed full release CI, deployed the API, PDS, and Vercel app, promoted the
production domains, and passed hosted smoke and signed-in identity. Its live
Stripe-session step was **skipped** because checkout remains disabled. The
[read-only production billing inventory for v11](https://github.com/RebuildingAmerica/atlas/actions/runs/36337900455)
returned **NO-GO** on this exact release: checkout is closed and the production
offer allowlist is absent. It verified that Stripe key, catalog, and webhook
secret names are configured, but could not inspect their values or prove a
charge-enabled account, signed webhook delivery, Tax, portal, or the live
purchase and refund lifecycle. It changed no settings and moved no money. The
release proves the code was deployed and basic hosted journeys work; it does not
prove real visitors can complete a Las Vegas discovery task, that profile claims
have been editorially reviewed, or that a payment can settle and deliver access.
The browser policy in this environment denied a direct visual visit to the
public profile, so no direct production visual acceptance is claimed.

## Prior production release `v2026.09.27-19`

Commit `09164e05` adds fixed, redacted reason codes to the protected Stripe
runtime inventory. It distinguishes missing portal controls and required webhook
events without logging Stripe identifiers, secrets, or provider error text.
Production tag `v2026.09.27-18` did not deploy: its full app test job failed on
an unrelated brief-save assertion that checked the confirmation before an
asynchronous save resolved. Commit `6c2318e6` waits for that confirmation in the
test; all 3,911 app tests passed locally at 100% coverage afterward.

[Production run 36355291754](https://github.com/RebuildingAmerica/atlas/actions/runs/36355291754)
passed full CI, deployed the API, PDS, and Vercel app, and passed hosted smoke
and signed-in identity on commit `6c2318e68406ab9148fa4090784f0b5c080ecf9e`. The
hosted checkout job completed with its live Stripe-session step skipped because
checkout is disabled.

The protected, read-only
[billing run 36356446068](https://github.com/RebuildingAmerica/atlas/actions/runs/36356446068)
returned an overall **NO-GO** for the exact deployed revision:

| Deployed Stripe check              | Result   | Fixed diagnostic code                                                                                                               |
| ---------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Live runtime key                   | Pass     | —                                                                                                                                   |
| Charge-enabled account             | Pass     | —                                                                                                                                   |
| Stripe Tax active in live mode     | Pass     | —                                                                                                                                   |
| Active catalog objects and IDs     | Pass     | —                                                                                                                                   |
| Default customer portal controls   | **Fail** | `portal_default_missing`                                                                                                            |
| Required webhook endpoint metadata | **Fail** | Missing `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `refund.created`, and `refund.updated` |

The same run found `ATLAS_BILLING_ALLOWED_OFFERS` absent in Vercel Production
and checkout disabled. The existing bootstrap can reconcile the webhook event
list for the matching endpoint when run with an authorized live Stripe key;
there is no current bootstrap path that creates the default customer portal.
Neither setting was changed by this inventory. Catalog amounts and terms, signed
webhook delivery, runtime write/refund permissions, settlement, entitlement,
cancellation, and refund remain unverified. No money moved.

## Prior production release `v2026.09.27-17`

Commit `1c2766a4` adds a secret-protected, read-only billing inventory inside
the deployed app. It reports only fixed pass/fail/unverified statuses for key
mode, charge capability, Tax, default portal controls, active catalog objects,
and webhook endpoint metadata. The manual billing-readiness workflow rejects a
report from a different release SHA and keeps the paid gate closed if any check
fails or is unverified. Commit `30c0a90a` marks synthetic test credentials and
SHAs for the repository's secret scanner; it does not change product behavior.

The first tag, `v2026.09.27-16`, did not deploy. Its CI failed the secret scan
on those synthetic fixtures and browser acceptance because its local API server
did not start; the run was cancelled before deployment. The v17 local browser
suite passed all 29 tests, and
[staging run 36351200466](https://github.com/RebuildingAmerica/atlas/actions/runs/36351200466)
passed CI and hosted smoke on commit `30c0a90a22447171dcce677991487d1647fc08c1`.

[Production run 36351307425](https://github.com/RebuildingAmerica/atlas/actions/runs/36351307425)
passed full CI, deployed the API, PDS, and Vercel app, promoted production
domains, and passed hosted smoke and signed-in identity. The hosted checkout job
succeeded, but its live Stripe-session step was **skipped** because checkout is
disabled. This release did not submit a live payment.

The protected inventory in
[billing run 36352514090](https://github.com/RebuildingAmerica/atlas/actions/runs/36352514090)
returned the exact deployed v17 revision. Its read-only checks reported:

| Deployed Stripe check              | Result   |
| ---------------------------------- | -------- |
| Live runtime key                   | Pass     |
| Charge-enabled account             | Pass     |
| Stripe Tax active in live mode     | Pass     |
| Active catalog objects and IDs     | Pass     |
| Default customer portal controls   | **Fail** |
| Required webhook endpoint metadata | **Fail** |

The same run confirmed that `ATLAS_BILLING_ALLOWED_OFFERS` is absent in Vercel
Production and checkout remains closed, so its overall decision is **NO-GO**.
The fixed statuses do not reveal which portal control or webhook endpoint
setting failed. An operator must inspect those settings in the same live Stripe
account and correct the mismatch, then rerun this inventory. This check does not
verify catalog amounts and terms, webhook signing-secret match or delivery,
write/refund permissions, a settled charge, entitlement, cancellation, or
refund. No money was moved by the inventory.

## Prior production release `v2026.09.27-15`

Commit `6c46de4a6f135fcd3e7742b2acd1bb8317810315` makes Explore the primary
public destination. Signed-in visitors get direct access to Saved work, and
people with a team workspace or organization setup task get a Your organization
link. Map, People, Organizations, Pricing, Firehose, Docs, and API remain
reachable in a More menu on desktop and phone. The error-page header does not
expose a Saved link. This changes navigation hierarchy; it does not resolve the
quality of search results or complete a signed-in organizer task.

The app suite passed 3,890 tests at 100% statement, branch, function, and line
coverage locally. A browser acceptance check exercised the menu, Map route,
visible primary action, and header overflow at 1280px and 390px. The full
pre-push gate passed 33 tasks under Node 24. An initial push from the system's
Node 26 failed because `better-sqlite3` had been compiled for Node 24; rerunning
the same gate under the repository runtime passed without a code change.

[Staging run 36347105511](https://github.com/RebuildingAmerica/atlas/actions/runs/36347105511)
passed CI, browser acceptance, and hosted smoke on attempt 2. The first hosted
public-page smoke test timed out at 30 seconds while loading multiple pages in
sequence; the failed-job retry passed on the same commit. This is a release-test
reliability issue, not evidence that the first attempt passed.

[Production run 36347637898](https://github.com/RebuildingAmerica/atlas/actions/runs/36347637898)
passed full CI, deployed the API, PDS, and Vercel app, promoted the production
domains, and passed hosted smoke, signed-in identity, and checkout checks on the
first attempt. The hosted checkout job did not submit a live payment because
checkout is closed.

The read-only
[production billing inventory for v15](https://github.com/RebuildingAmerica/atlas/actions/runs/36348837406)
returned **NO-GO** on this exact tag. Checkout is closed and
`ATLAS_BILLING_ALLOWED_OFFERS` remains absent in Vercel Production. The Stripe
key, catalog, and webhook secret are configured by name, but their values and
the live account, genuine signed delivery, Tax, portal, settlement, entitlement,
cancellation, and refund lifecycle remain unverified. The inventory changed no
settings and moved no money. Editorially reviewed Las Vegas inventory, complete
public/organizer/team journeys, and a rollback drill remain open launch gates.

## Prior production release `v2026.09.27-14`

Commit `39f505493b600d64fbef87ba81d6cf6d4f35694b` keeps a visitor's place,
filters, map camera, and selected public profile while moving between the map
and list. The map exposes List view from both the unselected view and the
selected-result panel. The list highlights a selected result on its current page
or pins that public profile above the page when pagination would hide it; the
visitor can clear that selection and return to the map. This removes a handoff
dead end, but it does not establish that Las Vegas has useful reviewed profiles
to discover.

The local app suite passed 3,888 tests with 100% statement, branch, function,
and line coverage. Four affected map browser tests passed locally, and the
normal pre-push quality gate passed all 33 tasks.
[Staging run 36343759463](https://github.com/RebuildingAmerica/atlas/actions/runs/36343759463)
passed CI, browser acceptance, and hosted smoke on attempt 2. Its first hosted
public-page check timed out; the retry passed. The app-only staging workflow did
not redeploy the API or PDS.

[Production run 36344298946](https://github.com/RebuildingAmerica/atlas/actions/runs/36344298946)
passed full release CI. Its first deploy attempt failed because the newly built
API container did not become ready on port 8000. The deploy service account
could not read Cloud Run logs (`PERMISSION_DENIED` for log views), so the
immediate startup cause is unknown. A failed-job retry of the same tagged commit
successfully deployed the API, PDS, and Vercel app, promoted the domains, and
passed hosted smoke, signed-in identity, and checkout checks. The successful
retry shows the revision started; it does not explain the first failure. The
hosted checkout job did not exercise a live payment because checkout is closed.

The read-only
[production billing inventory for v14](https://github.com/RebuildingAmerica/atlas/actions/runs/36346018704)
returned **NO-GO** on this exact tag. The checkout flag is closed and
`ATLAS_BILLING_ALLOWED_OFFERS` is absent in Vercel Production. Stripe key,
catalog, and webhook secret are present by name, but this job could not read
their sensitive values or verify account capability, catalog contents, signed
delivery, Tax, portal, runtime permissions, settlement, entitlement, cancel, and
refund. The inventory changed no settings and moved no money. A populated mobile
visitor journey, editorially reviewed Las Vegas inventory, and rollback drill
also remain unverified.

## Prior production release `v2026.09.27-12`

Commit `7038c3348aef66d957286d692df82292c8c7f59b` replaces the repeating
showcase on the public People and Organizations index pages with searchable,
paginated directories. A visitor can filter by place and issue and reach records
beyond the initial catalog slice. Each page keeps its person or organization
scope fixed, removes the misleading type control, and gives its search field a
scope-specific accessible name. The page and search metadata now describe linked
sources and contact details as available rather than promising them on every
record.

The app suite passed 3,878 tests at 100% statement, branch, function, and line
coverage, and the normal pre-push gate passed all 33 repository quality tasks.
[Staging run 36338881457](https://github.com/RebuildingAmerica/atlas/actions/runs/36338881457)
passed CI and browser acceptance on the exact commit. Its first hosted smoke
attempt timed out on both the API health and public-page checks; the retry
passed. The app-only staging workflow skipped API/PDS deployment and hosted
identity.
[Production run 36339500722](https://github.com/RebuildingAmerica/atlas/actions/runs/36339500722)
passed full release CI, deployed API, PDS, and Vercel, promoted the production
domains, and passed hosted smoke and signed-in identity. The live Stripe-session
step was **skipped** because checkout remains disabled.

The
[read-only production billing inventory for v12](https://github.com/RebuildingAmerica/atlas/actions/runs/36339538447)
returned **NO-GO** on the exact release: checkout is closed and the production
offer allowlist is absent. It verified that the Stripe key, catalog, and webhook
secret names are configured, but their sensitive values were unreadable in this
job. Account capability, catalog contents, genuine signed delivery, Tax, portal,
runtime permissions, and the payment and refund lifecycle remain unverified. The
inventory changed no settings and moved no money. This release proves deployment
and basic hosted routes, not a successful Las Vegas discovery task with reviewed
profiles or a paid purchase.

## Implemented outcomes

| Outcome                                                  | Implementation evidence                                                                                                                                                                                                                                                                                                                                                                                   | Acceptance still needed                                                                                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correction notes stay private                            | `8417b4fd` separates anonymous status from review evidence.                                                                                                                                                                                                                                                                                                                                               | Deploy and submit a synthetic report; prove anonymous readers cannot retrieve its note and an authorized reviewer can.                                                                |
| A member cannot open team billing                        | `8417b4fd` guards the portal at the server.                                                                                                                                                                                                                                                                                                                                                               | Signed-in member, admin, owner, and cross-workspace checks against the deployed app.                                                                                                  |
| Unapproved offers cannot start a sale                    | `d0fdb5c4` adds an exact production offer allowlist to pricing and Checkout. The September 27 Production inventory found the allowlist absent and checkout disabled.                                                                                                                                                                                                                                      | Set and verify only accepted offers after the full paid-journey proof; check every visible price and disabled offer.                                                                  |
| A paid session belongs to its saved purchase             | `4ca37d58` matches workspace, product, interval, and session before fulfillment. `25a2543f` aligns the older isolation test.                                                                                                                                                                                                                                                                              | Test-mode purchase, signed webhook, replay, and returning paid access.                                                                                                                |
| Delayed and refunded payments do not leave false access  | `8417b4fd`, `db9d4a14`, and `9ddfa1d4` gate settlement, attribute refunds, revoke a fully refunded term, and provide a previewable operator command.                                                                                                                                                                                                                                                      | Run test-mode async success/failure, cancellation, full refund, retry, and entitlement checks; then inspect live delivery.                                                            |
| Visitors can start with search                           | `1a2832aa` moves mobile Browse search ahead of issue panels; `e615149f` makes home People and Organizations shortcuts use type filters.                                                                                                                                                                                                                                                                   | Retest with a populated API on physical mobile and complete ten launch questions.                                                                                                     |
| Bike and bicycle searches reach the same actors          | Public entity and map search now match common bike/bicycle wording in either direction while retaining other search words and place/issue filters. Punctuation is treated as ordinary word separation instead of causing an SQLite query error.                                                                                                                                                           | Run Las Vegas visitor questions with reviewed real records on the deployed release. Search wording cannot repair missing local supply.                                                |
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
`ATLAS_BILLING_ALLOWED_OFFERS` variable required by the paid release gate was
absent in the September 27 Production inventory. The September 27 deployment
workflow recorded the GitHub checkout flag as `false`; the billing inventory
separately confirmed that the flag was closed. Sensitive Stripe values could not
be read through the CLI job, but the v19 protected app-runtime inventory did
verify a live runtime key, charge-enabled account, active Tax, and active
catalog identifiers. It found no default customer portal configuration and four
missing async-payment and refund webhook events. `pnpm stripe:verify:prod` still
cannot inspect the live catalog amounts from this checkout because it has no
`.env.production` verification inputs. These facts do not prove webhook delivery
or ability to complete and refund a charge.

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

| Gate                    | Deliverable and observable pass condition                                                                                                                                                                                                                   | Status                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release baseline        | Run required CI and hosted checks on the exact candidate, deploy, and exercise rollback.                                                                                                                                                                    | `v2026.09.27-19` passed production CI, deployment, hosted smoke, and identity. The live checkout step was skipped because sales are closed; a rollback drill remains unverified.                                                                                                                                                                                  |
| Private corrections     | Synthetic reporter and moderator journey on staging, with response ownership and urgent escalation.                                                                                                                                                         | Code committed; runtime and staffing unverified.                                                                                                                                                                                                                                                                                                                  |
| Reviewed coverage slice | Name one geography and one or two issues; choose ten real visitor questions; review each returned profile for identity, current work, geography, sources, and safe next step. At least three useful results for each promoted query, or narrow the promise. | [Las Vegas](2026-09-23-las-vegas-coverage-gate.md) is the home-market gate. The September 23 city snapshot had zero public-transit entries and no listed website or email across transit/housing candidates; no later reviewed inventory is recorded. Acquire and review useful local supply before promoting a pilot. Seattle remains comparative evidence only. |
| Public journey          | Mobile browse, result choice, profile evidence, source opening, correction, empty/error states, keyboard and screen-reader essentials on the exact build.                                                                                                   | Search placement, source-first profiles, searchable People/Organizations directories, map-to-list selection handoff, and task-focused public navigation are deployed; phone-based search-to-action and correction outcomes remain unverified.                                                                                                                     |
| Organizer journey       | Normal registration, passkey and recovery on physical devices, pending save, list note, reopened work, brief/export, and pricing clarity.                                                                                                                   | Save intent, save failure, and brief selection repaired; complete journey unverified.                                                                                                                                                                                                                                                                             |
| Team journey            | Workspace creation, invitation send/accept/wrong-account/expiry, roles, shared work, ownership departure, seat totals, and billing authorization.                                                                                                           | Portal guard, invite retention, access-change confirmations, and owner handoff implemented locally; full journey unverified.                                                                                                                                                                                                                                      |
| Paid journey            | Provider inventory and the full matrix above, per enabled offer.                                                                                                                                                                                            | Closed; the offer allowlist is absent and checkout disabled. The v19 runtime key, charge capability, Tax, and catalog ID checks passed; no default portal exists and four async-payment/refund webhook events are missing. Amounts, terms, signed delivery, runtime write permissions, and live lifecycle remain unverified.                                      |
| Operations              | Name a release owner, editorial reviewer, support inbox owner, refund operator, daily correction/review window, and incident escalation. Record a rehearsal, not only a policy.                                                                             | Ownership and rehearsal not evidenced in this checkout.                                                                                                                                                                                                                                                                                                           |

The first public release should be a named pilot with reviewed records and
staffed support. The national catalog can remain browsable with honest coverage
limits; national promotion waits for task usefulness across the places claimed.
The paid gate is independent of free browsing. Do not open Team merely because
individual Pro passes: seats, invites, ownership, and shared billing have their
own acceptance rows.

The current branch adds a profile-correction inbox at `/admin/corrections`. It
lists open visitor reports with the affected profile, reason, and private note,
oldest first; resolve and dismiss actions update the open queue. The API rejects
anonymous and non-operator reads, requires the configured operator email
allowlist for moderation decisions, and sends `no-store` headers. This has local
test coverage, but it has not been deployed or rehearsed with a real report and
assigned editor. The inbox does not itself edit a profile or cover source-level
flags. Those operating steps remain part of the private corrections gate.

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
