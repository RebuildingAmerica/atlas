# Las Vegas pilot evidence board

Opened September 28, 2026 · production release `v2026.09.28-4` · decision
**NO-GO**

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

| Defect                                                                                                                                                  | Found      | Fixed in                                                    | Production check |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------- | ---------------- |
| Any signed-in account could approve profile verifications and change discovery schedules.                                                               | 2026-09-28 | Branch `fix/staff-review-and-private-runs` (not yet merged) | Pending          |
| Any signed-in account could read other workspaces' private research runs, and any signed-in MCP client could read them through the discovery-run tools. | 2026-09-28 | Branch `fix/staff-review-and-private-runs` (not yet merged) | Pending          |

## Log

Newest first. Each entry: date · release · actor · observation · result.

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
