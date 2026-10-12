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

Snapshot: October 12, 2026, 19:23 UTC.

Source integration and branch retirement are complete. Hosted release is not.
The release remains unchecked above because sign-in and the protected admin have
not passed production acceptance together with the Cloudflare frontend. This
distinction protects people's existing accounts, private applicants, invitation
links, and purchases during the hosting change.

The original integration passed all 37 repository quality tasks. API tests
passed 2,774 cases with eight skips, app tests passed 4,256 with one skip, and
admin tests passed 112; all three packages met their 100% coverage gates.
Generated contracts, bootstrap and deployment tests, workflow lint, PostgreSQL
merge/takedown tests, and the admin production build/dry run passed. The local
paid-waitlist browser journey verified the Access assertion, admin signing,
platform authorization, protected callback, retained store effects, captured
email, and operator audit attribution. Visual review covered the operator queue,
audit details, and mobile invitation. These local checks do not prove provider
delivery, a completed Stripe payment, or live Workspace sign-in.

The integration landed through
[PR #8](https://github.com/RebuildingAmerica/atlas/pull/8) on October 11, 2026,
with its reviewed commits retained through a rebase. Main at that landing was
`28938df5ae32c961e9af43ea22821e713a24c8b4`. The original integration
[CI run](https://github.com/RebuildingAmerica/atlas/actions/runs/38119701104)
passed. Both `feature/admin-separation` and
`feature/admin-separation-completion` were retired locally and remotely, and the
original feature worktree was removed. Unrelated worktrees and stashes were
preserved.

The following October 12 evidence records the API and account-service
restoration. Frontend and protected-admin release acceptance remains incomplete:

- [API publication #134](https://github.com/RebuildingAmerica/atlas/actions/runs/38259474718)
  succeeded for `880d8f83f9a6a6e1129ea6e60009581dbba6be8b`. Its retained
  manifest reported `verified-paused` for the API/discovery pair, preserving API
  namespace `dc3b7c8a2f684dba92f35c18dad03d3f` and discovery namespace
  `cecc646cdabd4896b73fee640fd5782f`.
- [Protected API verification #135](https://github.com/RebuildingAmerica/atlas/actions/runs/38261761483)
  passed for that retained release. Independent public readback returned HTTP
  200 from the API health endpoint, and the public directory and a source-linked
  organization profile rendered successfully. A fresh October 12 check still
  returns HTTP 200 from the API health endpoint.
- [Web candidate #136](https://github.com/RebuildingAmerica/atlas/actions/runs/38262678714)
  failed before publishing the frontend or admin. The existing Google workload
  identity and IAP SSH connection reached the PDS host, but three Secret Manager
  reads returned HTTP 403. The old host script masked those failures, replaced
  `pds.env` with incomplete credentials, and restarted the PDS. The public PDS
  health endpoint returned HTTP 502 after that attempt. The later host check
  below established the provider error category; normal deployment #142 then
  restored the original credentials and service.
- The corrected host-check source at `c62ee6e6eb2c26c7a56a9a592aa4e3c97bb244b8`
  aborts on failed credential reads or invalid Compose configuration before
  replacing credentials. The permanent read-only host check uses the same
  workload identity and IAP connection. Its corrected input handling passed all
  42 PDS tests, 343 deployment tests, workflow lint, the complete secret scan,
  and all 37 pre-push quality tasks.
- [Hosted doctor #139](https://github.com/RebuildingAmerica/atlas/actions/runs/38288182704)
  ran the corrected host check for `v2026.10.12-cf.15`. All CI jobs passed,
  including 3,005 API tests at 100% coverage. The host check then failed with
  `BILLING_DISABLED` on all three original Secret Manager values. The metadata
  token has the cloud-platform scope. Neither the deployment/data directories'
  root-only `pds.env` copies nor the matching retained PDS container contained
  complete credentials. This check does not exhaust manual backups, boot-disk
  snapshots, other containers, or off-host recovery sources. It made no host
  configuration changes and did not recover the keys.
- After the operator re-enabled Google billing,
  [normal deployment #142](https://github.com/RebuildingAmerica/atlas/actions/runs/38293177989)
  restored the original account-service configuration through the existing
  workload identity and IAP connection. Its public health and invitation-broker
  route checks passed. The normal deployment at `c3b0f56e` validates the
  original Secret Manager values and Compose configuration before replacing the
  environment, and converges the existing services. The separate PDS recovery
  operation was removed. Fresh public readback returns HTTP 200 from both API
  and PDS health endpoints. Public PDS reads also found an existing repository;
  this is not proof of identity continuity or data completeness.
- The web candidate in #142 then stopped before artifact creation because its
  selected retained API source came from an older commit. No frontend or admin
  was published by that attempt. Source and artifact identity checks remain
  enforced.
- The search-facet optimization and read-only secret scan landed on main at
  `311366aea13a88a69e2cc65e58dd4ee1eec59b67`, tagged `v2026.10.12-cf.19`. The
  optimization passed 2,997 API tests at 100% coverage and the two changed
  PostgreSQL tests. All pre-push checks passed.
  [API deployment #143](https://github.com/RebuildingAmerica/atlas/actions/runs/38297145136)
  is running from that source to establish matching retained artifacts for the
  web candidate. Its deployment result and hosted query savings are not yet
  verified.

The API is serving public traffic through Cloudflare. Atlas's frontend remains
on Vercel, and the Cloudflare admin release remains unverified. Retained routing
and rollback artifacts are preserved. The obsolete encrypted broker-export and
billing-repair artifacts were deleted with the user's explicit confirmation;
GitHub readback shows empty artifact lists for both old runs.

Finish the release by proving each remaining production requirement:

- Verify existing sign-in identities against the restored original PDS
  configuration. Do not rotate identity keys or reset retained data.
- Publish and verify the exact Cloudflare frontend and Access-protected admin
  versions. Prove operator entry, refusal of unauthenticated/non-org/forged
  assertions, private applicant isolation, invitation behavior, and audit
  attribution against the retained store.
- Verify customer and editorial sign-in, retained invitation links and purchase
  associations, provider email delivery, billing journeys, and authenticated MCP
  clients through the production authority chain.
- Establish fresh proof that legacy discovery consumers are stopped before
  activating the published discovery runtime. Complete the required capacity and
  cost acceptance; the last paused manifest is not activation evidence.
- Rehearse recovery with the actual retained runtime and routing identities,
  then promote the canonical frontend and retire Vercel and obsolete candidate
  resources after replacement and recovery are verified.

Follow `docs/deployment/cloudflare-publication.md` for the protected workflow.
Keep the release unchecked until this evidence exists. Local tests, tags, source
integration, and branch retirement do not establish production recovery. All
agent-run authentication must continue to avoid Keychain-backed credential
lookups; use existing noninteractive deployment identities and authorized
browser sessions. Google billing was re-enabled by the operator before normal
deployment #142 restored the account service.
