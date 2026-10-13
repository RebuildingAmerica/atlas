# Atlas deployment

Atlas publishes through the protected Cloudflare staging and production
workflows. They build from the selected commit, release Workers and static
assets together, and retain an immutable release bundle for rollback.

Run `pnpm doctor` to inspect local configuration without changing providers. Use
the **Deploy Staging** workflow for a candidate and **Deploy Production** for
production operations. Production promotion requires a retained Cloudflare
rollback release and validates the canonical Atlas URL after routing changes.

Cloudflare Web Analytics is enabled at the zone for the Atlas production and
staging hostnames. Workers Observability supplies runtime telemetry.

## Billing

Stripe settings remain in GitHub deployment environments and are passed only to
the protected publication workflow. `pnpm stripe:verify:staging` and
`pnpm stripe:verify:prod` validate the selected local target and Stripe catalog;
the deployed billing inventory endpoint is the release-level readback.

## One-person operations

The operator should use the rollback workflow before manually changing routes.
Keep the current Cloudflare release bundle until the canonical site, sign-in,
profiles, workspaces, and billing readback are healthy.
