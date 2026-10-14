# Cloud cost standards

[Docs](../README.md) > [Standards](./README.md) > Cloud cost standards

Atlas's public web, API, and discovery Workers stay on Cloudflare Free. Cost
controls protect the public directory, sign-in, and source-linked profiles from
quota exhaustion. The Google-hosted PDS is a separate dependency; Google billing
remains closed.

## Publication guardrails

- Use the protected Cloudflare publication `doctor` before a release. The
  release evidence must measure current usage and the other Workers sharing the
  account, then show at least 20% headroom at twice Atlas's candidate load.
- Check Workers requests and CPU, Durable Object requests, duration, rows
  read/written and storage, and Hyperdrive queries. The enforced Free thresholds
  are in [`scripts/deploy/web-assess.mjs`](../../scripts/deploy/web-assess.mjs);
  provider limits can change, so verify them against the account dashboard
  before revising those thresholds.
- Record discovery provider spend in the cost ledger. Keep per-run and rolling
  daily ceilings and the discovery-spend switch in force. Pausing discovery is
  preferable to risking an unbounded bill or hiding incomplete profiles.
- Use Workers Observability for errors and duration. Keep logs concise and
  redacted; inspect log volume and retention in the Cloudflare account rather
  than assuming they cost nothing.
- Builds and GitHub artifact retention use their own allowances. Check the
  account's build minutes, GitHub Actions usage, and artifact storage when
  forecasting a release. Do not run repeated publication attempts to measure a
  known unchanged failure.
- Cloudflare Free is a hard constraint. A forecast over the allowance is a
  release blocker, not an automatic paid upgrade. Budget notifications warn the
  operator; they do not cap spend.

## Operator view

The protected platform admin at
`https://atlas-admin.rebuildingus.org/cloud-costs` shows the discovery ledger
and known accounting gaps. It is not a live Cloudflare quota dashboard. Use
Cloudflare's Workers, Durable Objects, Hyperdrive, and Observability views for
provider usage. Treat an inaccessible billing or usage readback as unknown,
never as `$0`.

The PDS's Google status and costs must be checked separately. Atlas's Cloudflare
publication does not restore a Google service while that billing account is
closed.
