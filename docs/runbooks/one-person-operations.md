# One-person operations

Atlas has one operator. Keep the public directory, source-linked profiles,
accounts, and corrections usable with a short routine and clear recovery steps.

## Signals

- The hourly `production-canary.yml` checks public availability independently of
  the hosting provider. Failed runs notify through GitHub.
- Cloudflare Workers Observability shows web, API, and discovery exceptions and
  duration. Check the Cloudflare account's notification configuration; the old
  Google Cloud Run alert does not watch these Workers.
- Stripe sends webhook-failure and dispute notices to the account owner. Visitor
  reports appear in the editorial correction queue.
- The PDS is a separate Google-hosted dependency. Check its health directly; a
  healthy Cloudflare Worker does not prove that identity and invitations work.

## Routine

Each week, review the correction queue at `/editorial/corrections`, Stripe
webhook failures and disputes, the last seven production canaries, and two
source-linked profiles on a phone. Each month, run the source-staleness scan and
recheck the official sources behind reviewed profiles. Pause discovery spend in
the platform admin if the ledger approaches its ceiling.

For a privacy or safety report, act the same working day. Review wrong or
unsupported claims on promoted profiles within two working days. Decide refund
requests within two working days and confirm any approved refund changed
entitlement. Keep the visitor's report status current.

## Incident response

1. Check the canary, canonical web and API endpoints, and Cloudflare Workers
   Observability. Read the exact Worker version and routes with `cf`. Check the
   PDS separately.
2. If a new release broke profiles, sign-in, or workspaces, use the protected
   **Roll Back Production** workflow with that release's routing journal. For
   the initial cutover, use the immutable Worker-version procedure in the
   [Cloudflare publication guide](../deployment/cloudflare-publication.md#restore-an-existing-worker-version),
   then verify real journeys. A version selection does not revert a database or
   API/discovery change.
3. If a profile makes an unsupported claim, stage a correction in
   `/editorial/discovery-reviews` or remove the claim. If a payment failed, use
   the platform admin's billing controls and verify entitlement after the
   correction.
4. If the operator will be away longer than the response targets, pause new
   checkout and discovery spend in the platform admin; leave correction intake
   open. Resume only after checking the queue and public journeys.

Do not reopen Google billing as a side effect of a Cloudflare incident. If PDS
health fails while billing remains closed, record identity and invitation
acceptance as blocked until that dependency is restored or replaced.
