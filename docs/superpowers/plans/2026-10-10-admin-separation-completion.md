# Admin separation completion implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or
> superpowers:executing-plans to execute the tasks below. The user has
> authorized completing, landing, and retiring this branch.

**Goal:** Land the approved admin separation without breaking the paid-access
waitlist added on main afterward, then verify and release the combined result.

**Architecture:** Editorial authority stays with instance operators. Private
paid-access review belongs to platform operators behind Cloudflare Access. The
platform API verifies the existing admin assertion and Access assertion, then
calls a narrow callback into the app's existing waitlist store and mailer.
Public signup, bearer links, purchases, and retained records stay in the app.

**Tech stack:** Existing FastAPI, TanStack Start, shared packages,
PostgreSQL/SQLite, and Cloudflare admin Worker.

**Spec:** The approved admin separation plan at
`/Users/williecubed/.claude/plans/give-a-comprehensive-analysis-abstract-muffin.md`,
especially concerns 1 and 5; `docs/standards/internal-apps.md`.

## Global constraints

- Preserve every existing waitlist record, email link, invitation state,
  delivery record, and purchase association.
- Self-hosted instances expose no platform routes or paid-access administration.
- Instance operators and ordinary customer sessions cannot read private
  applicants or send invitations.
- Keep public signup behavior and private-page no-store, noindex, no-referrer,
  and analytics exclusions.
- Preserve main's patched dependencies and private discovery-run visibility.
- No new grants policy or feature flag system; both remain intentionally
  deferred.
- Stage and commit with the repository's atomic reset, explicit add, and
  commit-file chain. Never bypass hooks.
- Do not modify other worktrees or create credentials during implementation.

## Review focus

- Customer and instance-operator credentials must fail on paid-access staff
  operations.
- Forged Access headers and callback secrets must not reveal applicant data or
  send email.
- Retried invitations must preserve durable delivery and purchase checks.
- Missing provider configuration must fail explicitly and must not produce a
  false release claim.
- Old admin URLs must redirect to the correct new host while public bearer links
  keep working.

## Task 1: Integrate paid-access review with platform authority

**Files:** Existing waitlist staff service/functions/page and tests under
`app/`; platform authorization actions/router and tests under `api/`; platform
admin routes/navigation/functions/pages/tests under `admin/`; shared waitlist
contracts/UI only where both applications actually consume them; generated
OpenAPI/client and route trees.

**Interface:** Admin calls `/api/platform/waitlist` read and mutation operations
through `platformFetch`. API validates platform authority and calls an app
callback protected by `ATLAS_AUTH_CALLBACK_SECRET`. Callback operations are
explicitly enumerated and validated; the API supplies the verified operator
identity. Preserve existing results and store/mail behavior. The callback secret
is never exposed to a browser.

- [x] Add failing behavioral tests for platform-only staff access, callback
      authentication/validation, and existing invitation actions.
- [x] Move staff UI to the admin host, reusing existing presentation and
      contracts without app/admin imports or duplicated stores.
- [x] Add narrow platform API and callback handlers, audit staff decisions, and
      remove customer-session staff endpoints and Editorial waitlist links.
- [x] Update route tests, privacy checks, screenshots exclusions, and the
      waitlist browser journey for the actual authority chain.
- [x] Regenerate contracts and clients; run focused tests, type checks, and
      lint. Report red/green evidence.
- [x] Commit the independently reviewable integration after review; preserve
      every unrelated change.

## Task 2: Verify, land, release, and retire

**Files:** Existing quality/build/acceptance workflows and runbooks, plus any
confirmed integration defects. Only the parent handles source-control
integration and provider actions.

- [x] Verify the rebased range remains linear and review the original plan
      against the final code.
- [x] Run the complete repository quality suite, generated-contract checks,
      admin production build/dry run, relevant browser journeys, and PostgreSQL
      merge/takedown tests.
- [x] Resolve confirmed failures without weakening gates. Record exact provider
      blockers in the release evidence.
- [x] Land through a rebase or fast-forward, preserving commits and newer main
      work. Do not squash or introduce merge commits.
- [ ] Tag the verified release when its deploy prerequisites are satisfied and
      verify the deployment result.
- [x] Retire only this task's branches/worktrees after proving the work is
      retained on main. Preserve unrelated work and stashes.

## Completion evidence

The full repository quality graph passed all 37 tasks. API tests passed 2,774
cases with eight skips; app tests passed 4,256 with one skip; admin tests
passed 112. Each of these packages met its 100% coverage gate.
Generated-contract checks, 229 bootstrap tests, 93 deployment tests, actionlint,
PostgreSQL merge and takedown tests, and the admin production build/dry run
passed. The final paid-waitlist browser journey passed both tests using real
local Access JWT verification, admin signing, API authorization, the protected
callback, retained store effects, captured email, and operator audit
attribution. The operator queue, audit details, and applicant mobile invitation
were visually inspected. Independent final review found no remaining source
integration blockers.

Source integration landed through
[PR #8](https://github.com/RebuildingAmerica/atlas/pull/8) on October 11, 2026,
retaining the reviewed commits through a rebase. Fresh remote readback confirms
main at `28938df5ae32c961e9af43ea22821e713a24c8b4`. Both
`feature/admin-separation` and `feature/admin-separation-completion` are absent
locally and remotely, and the original feature worktree is removed. Unrelated
worktrees and stashes remain preserved. The original final integration
[CI run](https://github.com/RebuildingAmerica/atlas/actions/runs/38119701104)
passed before landing.

Hosted release remains incomplete. The linked Google Cloud billing account is
closed, and the production API failed the latest public checks (HTTP 500 and a
Cloudflare 403 on a second probe). The authorized Cloudflare recovery keeps
billing closed and avoids local Keychain-backed credential lookups. Its nine
native dependency wheel builds passed in
[run 38126916648](https://github.com/RebuildingAmerica/atlas/actions/runs/38126916648),
and its full integration test job passed in
[run 38126916841](https://github.com/RebuildingAmerica/atlas/actions/runs/38126916841).
That run's secrets scan failed on reviewed fixtures and public dependency
hashes; the exact baseline corrections pass the full local scan with every
detector and filter preserved. The next publication commit still needs fresh CI.

Keep the hosted release task unchecked until the exact Cloudflare API,
discovery, app, and protected admin versions are deployed and verified. This
includes the existing public API hostname and MCP clients, retained sign-in and
invitation identities, private applicant access, real delivery and billing
journeys, and recoverable routing. Local browser proof does not establish
provider email delivery or completed Stripe payment. Source integration and
branch retirement do not establish production recovery.

Repeated Cloudflare CLI invocations were found to read the profile encryption
key from macOS Keychain. Remaining source-control operations use the connected
GitHub app and Git SSH with Keychain and interactive authentication disabled.

The public API edge preparation and reversible route cutover are committed as
`85ae6e13` and `58a50647`. The route uses the existing proxied API DNS record,
retains its exact route ID, checks active API/discovery and edge versions, and
refuses changed ownership during recovery. All 301 deployment checks pass,
including protected probes, interruption recovery, retained runtime conflict
checks, billing preflight and credential-safe artifact retention. Workflow lint
also passes. These are source checks; no production cutover has occurred.

Read-only provider inspection confirms that CI has no general
`CLOUDFLARE_API_TOKEN`. Its existing production admin token permits only Workers
Scripts Edit and Workers Routes Edit; it cannot read subscriptions, Hyperdrive
or Access applications. Existing Access service credentials are configured only
in staging. Production still lacks the publication inputs for the zone, retained
database binding, operations hostname and measured handoff/capacity evidence.
The sole Hyperdrive configuration is a diagnostic configuration whose retained
production database identity remains unverified. No credentials were created,
widened, copied from a browser, or read from Keychain to work around these
blockers. Follow `docs/runbooks/cloudflare-production-recovery.md` for the
protected workflow. Scout tests also reached the native credential store through
a doctor probe; the test dependencies are now injected, and an autouse guard
rejects native credential-store access throughout the Scout suite. All 963 Scout
tests passed with that guard enabled.
