# One-person operations

Atlas has one operator. That person is the release owner, the editor, support,
the refund desk, and the escalation contact. This runbook sets commitments that
one person can keep, and replaces the staff a larger team would have with
alerts, a short routine, and a way to pause.

A promise Atlas cannot keep does more harm than a slower promise it does keep.
Every target below is sized to one person's capacity.

## What reaches the operator without anyone watching

| Signal                                                       | How it arrives                                                  | Set up by                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------- |
| The API logs an error                                        | Email, at most every 5 minutes                                  | Error Alerting workflow, "Atlas API errors" policy      |
| A visitor reports a profile or source                        | Email, at most every 5 minutes, linking to `/admin/corrections` | Error Alerting workflow, "Atlas visitor reports" policy |
| The public site, sitemap, catalog, or search stops answering | Failed hourly run notification from GitHub                      | `production-canary.yml`                                 |
| A Stripe webhook keeps failing, or a dispute opens           | Stripe's own email to the account owner                         | Stripe account notification settings                    |

The Error Alerting workflow needs the deploy service account to hold
`roles/monitoring.editor`, `roles/logging.configWriter` (every log-based alert
owns a Cloud Logging notification rule), and `roles/logging.viewer`.
`scripts/grant-monitoring-role.sh` grants them and dispatches the workflow with
the operator's email. Email channels need no confirmation; Cloud Monitoring has
no test button, so a real error or report is what proves delivery.

## Response targets

These are the commitments Atlas makes to people who report a problem or pay.
Hours are the operator's stated working hours in Pacific time.

| Kind                                                                                                 | Target                                                                        |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Privacy or safety report (a person's private information, a threat, a person who asks to be removed) | Acted on the same working day it arrives                                      |
| Wrong or unsupported fact on a promoted Las Vegas profile                                            | Reviewed within 2 working days; the profile is corrected or its claim removed |
| Other corrections and missing context                                                                | Acknowledged by status change within 5 working days                           |
| Refund request                                                                                       | Decided within 2 working days; approved refunds run the same day              |
| Failed purchase or lost access                                                                       | Answered within 2 working days                                                |

A report's reporter can see its status at `/reports/<reference>`.

## Weekly routine (30 minutes)

1. Open `/admin/corrections`. Close or act on everything older than its target.
2. Check the Stripe dashboard for failed webhook deliveries and open disputes.
3. Check the last seven `production-canary.yml` runs.
4. Open two promoted Las Vegas profiles on a phone and follow their official
   action link.

## Monthly routine (1–2 hours)

1. Run the stale-source scan (`POST /api/review-queue/source-staleness-scan`)
   and review what it queues.
2. Re-open the official page behind every reviewed Las Vegas profile. When a
   page no longer supports a claim, stage a correction or remove the claim.
3. Re-run the ten Las Vegas visitor questions from the pilot scorecard and note
   any that dropped below three useful reviewed results.

Both routines are recurring tasks in Docket so they surface without being
remembered.

## When the operator is unavailable

If the operator will be away longer than the 2-working-day targets, pause before
leaving rather than letting promises lapse:

1. **Stop selling.** Remove every offer from Vercel Production
   `ATLAS_BILLING_ALLOWED_OFFERS`, set the repository variable
   `ATLAS_BILLING_CHECKOUT_ENABLED=false`, and tag a release. Existing paid
   access is not removed.
2. **Stop promoting.** Take down any pilot announcement or outreach that points
   people at Atlas as a Las Vegas resource.
3. Leave corrections open. Reporters see "Waiting for an editor" until the
   operator returns.

Reverse both steps on return, after clearing the correction inbox.

## When something is broken

- **The API answers 500 everywhere and the canary fails:** dispatch the Diagnose
  Atlas API workflow for the affected environment. It prints the database's own
  error. A Neon error saying the project "exceeded the quota" means the plan ran
  out, as it did on September 30, 2026; raise the plan or wait for the monthly
  reset, then confirm `/health` and the next canary run. Rolling back does not
  help, because every release shares the same database.
- **A release hurts visitors:** roll back with the Roll Back Production
  workflow; see `docs/runbooks/vercel-incident-response.md`.
- **Wrong data is shown confidently on a promoted profile:** stage a correction
  in `/admin/discovery-reviews` and approve it, or reject the record's public
  change. Note it in the pilot evidence board.
- **A payment went wrong:** preview the refund with
  `cd app && pnpm billing:refund --session <cs_…>`, then run it with
  `--operator <email> --reason "<why>" --execute`. Confirm access was revoked.
