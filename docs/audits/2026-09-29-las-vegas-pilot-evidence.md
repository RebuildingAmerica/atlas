# Las Vegas pilot evidence board

Opened September 28, 2026 · current production release `v2026.10.02-2`
(`5f43e4d2`, deployed October 2, 2026) · decision **NO-GO**

This board records what has been observed for each gate of the Las Vegas pilot,
tied to the release that was deployed when it was observed. A gate changes only
when its evidence row names the release, the date, who acted, and what was seen.
Commits, green CI, and deployments are listed as context, never as acceptance.

Atlas is operated by one person. Every owner below is that operator; where a
gate would normally need a second person, the row says how it was handled.

## Current decision

| Scope                    | Decision | What would change it                                                                          |
| ------------------------ | -------- | --------------------------------------------------------------------------------------------- |
| Promoted Las Vegas pilot | NO-GO    | Every gate below is GO or explicitly narrowed, with the narrowed promise live in the product. |
| New paid sales           | NO-GO    | Each offer opens only after its own genuine purchase-to-exit row passes.                      |
| Broad national promotion | NO-GO    | Out of scope for this pilot.                                                                  |

## Gates

| Gate                              | Status | Evidence required                                                                                                                           | Evidence recorded |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Editorial supply                  | NO-GO  | Reviewed Las Vegas profiles public with identity, issue, geography, citations, official action; approval recorded with reviewer and date.   | None yet.         |
| Transit scope                     | NO-GO  | Promoted transit questions return useful reviewed answers, or the transit promise is narrowed in the product.                               | None yet.         |
| Housing scope                     | NO-GO  | Housing questions return relevant reviewed organizations with safe routes to join, contact, or get help; service providers labeled as such. | None yet.         |
| Ten public questions              | NO-GO  | Dated mobile results for all ten questions against the deployed release.                                                                    | None yet.         |
| Public UX and trust               | NO-GO  | Unaided search → claim → next step → report on a phone; accessibility and performance evidence for the release.                             | None yet.         |
| Corrections                       | NO-GO  | Hosted report → private review → disposition → reporter-visible status, no private-note exposure, operator alerted.                         | None yet.         |
| Individual organizer              | NO-GO  | Ordinary account: signup from a result, pending Save, list, note, return, brief, export, recovery.                                          | None yet.         |
| Organization admin                | NO-GO  | Workspace, invitation delivery and acceptance, wrong-account and expired paths, roles, shared work, owner handoff, seats.                   | None yet.         |
| Production Stripe configuration   | NO-GO  | Stripe and deployed-app readback: Atlas portal, webhook events, signing, offer allowlist.                                                   | None yet.         |
| Paid lifecycle (per opened offer) | NO-GO  | Genuine purchase, receipt, access, return, cancellation or expiry, refund and revocation, per offer.                                        | None yet.         |
| Operations and release            | NO-GO  | Operator runbook, alerts, correction/refresh routine, pause and rollback rehearsed, release-specific GO record.                             | None yet.         |

## Security fixes found during this pilot

| Defect                                                                                                                                                  | Found      | Fixed in                                               | Production check                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any signed-in account could approve profile verifications and change discovery schedules.                                                               | 2026-09-28 | `8ad023f1`, released in `v2026.10.02-2`                | 2026-10-02: anonymous `POST /api/profiles/claims/review/x/approve` returns 401 through the production app and API. A signed-in non-operator account seeing 403 is still to be observed. |
| Any signed-in account could read other workspaces' private research runs, and any signed-in MCP client could read them through the discovery-run tools. | 2026-09-28 | `8ad023f1` and `9930eaf6`, released in `v2026.10.02-2` | 2026-10-02: anonymous `GET /api/discovery-runs` returns 401 on the production API. A cross-workspace read by a signed-in account is still to be observed.                               |

## Log

Newest first. Each entry: date · release · actor · observation · result.

- 2026-10-02 · `v2026.10.02-2` · Operator and Claude · The operator granted
  `roles/logging.configWriter` to the deploy account from Cloud Shell; the next
  `error-alerting.yml` run created the "Atlas API errors" and "Atlas visitor
  reports" log-based policies on the operator's email channel. · Alerts
  provisioned. Delivery is unproven until a test error and a test report each
  produce an email (Task 4.2).

- 2026-10-02 · `v2026.10.02-2` · Claude · `deploy-production.yml` run
  37053223990 passed every job, including hosted smoke, hosted checkout, and
  hosted identity. Readback: API `/health`, app `/`, `/browse`, and proxied
  `/api/entities` return 200; anonymous profile-verification approval and
  `/api/correction-inbox` return 401 through the app; unknown report status
  returns 404 from the API. · Release live. Gates unchanged.
- 2026-10-02 · `v2026.10.02-1` · Claude · The API and PDS deployed, but Vercel
  refused the app build over the TanStack Start server-function XSS
  (CVE-2026-102989), so production served the new API behind the previous app
  until `v2026.10.02-2` shipped the patched TanStack Start. · Superseded.
- 2026-10-02 · `v2026.10.02-2` · Claude · `error-alerting.yml` run 37045872284
  created the email channel for the operator, then Cloud Monitoring refused the
  first log-based alert policy with 403: log-based policies need
  `logging.notificationRules.create` (`roles/logging.configWriter`), which the
  deploy account lacks. · Operator alerts not yet live; waiting on the operator
  to grant the role (`scripts/grant-monitoring-role.sh` now includes it).
- 2026-09-30 to 2026-10-01 · `v2026.09.28-4` · Claude · Production and staging
  APIs returned 500 because the Neon project exceeded its compute quota; the
  discovery worker's 10-second polling kept the database from suspending. The
  operator upgraded the Neon plan, and the hourly production canary has passed
  since 2026-10-01 05:53 UTC. The worker now backs off to 15 minutes while no
  job waits and wakes immediately when one is queued (`df2633c8`). · Outage
  closed; no rollback rehearsal was involved.

- 2026-09-28 · `v2026.09.28-4` · Claude · Baseline of the ten questions against
  the production API (`state=NV&city=Las Vegas`): public transit 0 results;
  "bus", "bicycle", "pedestrian", and "eviction" text searches 0; housing 4
  (three city boards plus the NAACP branch); housing people 0; transportation
  tag 3 (two city traffic committees plus the NAACP branch). Every result is a
  government board or the NAACP branch, with one source each and no action link.
  · No question has a useful answer today. City boards and committees are
  excluded from any promoted answer.
- 2026-09-28 · `v2026.09.28-4` · Claude · Public API
  `GET /api/entities?city=Las Vegas&state=NV` returns 73 records (45 people, 28
  organizations, 70 single-source); none of the editorial packet's candidates is
  published. · Baseline.
