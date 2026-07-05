# Governed Agent Access And Metering PRD

Status: Draft Date: 2026-07-05 Owner: Rebuilding America Project

## User Outcome

AI agents, developers, and partner organizations can use Atlas data and
capabilities at machine scale through a governed, metered path that keeps every
result source-linked, while people and light programmatic use keep free access
to the public civic graph. Heavy automated use becomes paid, accountable access
instead of anonymous scraping.

## Product Position

Atlas is both a product and a platform, and agent traffic arrives whether or not
Atlas meters it. Metering funds and protects the public civic graph; it does not
charge for reading it. Nobody pays to see civic data; workspaces pay to use it
at scale. The metered path is the accountable alternative to bulk scraping: the
same traffic Atlas would otherwise block, made to sign in, follow a use policy,
carry its sources, and pay for the load it creates. Revenue funds the map; it
never privatizes the public civic graph.

## Users

- AI agent or assistant reading Atlas at machine scale.
- Developer or civic technologist building on the API or MCP.
- Partner organization embedding source-linked civic data.
- Funder underwriting open access to a place, issue, or dataset.
- Workspace administrator managing usage, budget, and billing.
- Atlas maintainer protecting the civic graph from harvest and misuse.

## Core Requirements

1. Free public access
   - Human browsing, casual reads, and an unauthenticated light-use tier stay
     free, forever.
   - Free responses carry the same trust summary and source metadata as paid
     ones.
   - Free access is never degraded to upsell a paid tier.

2. Usage-based metering
   - Every external API and MCP call is metered per workspace.
   - Plans include a monthly quota with metered overage above it.
   - Usage is visible to the workspace in an honest, real-time dashboard,
     itemized by surface and route.

3. Enforced tiers and limits
   - Per-plan request budgets are enforced, not merely advertised.
   - Anonymous traffic is held to the free light-use ceiling.
   - Over-limit requests return a machine-readable challenge that names the
     limit, the window, current usage, and an upgrade or purchase path.
   - Paid lanes are never silently throttled; remaining budget stays legible.

4. Verified-agent lane
   - Authenticated agents receive higher budgets than anonymous callers.
   - Agents that present verifiable identity receive a trusted,
     higher-throughput lane.
   - Anonymous high-volume traffic is throttled or blocked first when protecting
     the graph.

5. Provenance-carrying results
   - Every metered payload embeds source URL, publication, published date,
     confidence, freshness, review state, and usage restrictions.
   - A stripped-provenance feed is never offered at any price.
   - Payloads expose stable citation URIs so an agent can dereference and cite
     the record.

6. Metered billing and prepaid credits
   - Settlement runs in fiat through the existing billing system.
   - Workspaces can pay usage-based overage or purchase prepaid access credits.
   - Each metered call debits included quota or credit balance; billing
     attributes to the workspace.
   - Metered pricing and quotas are published, uniform, and free of bespoke
     exceptions.

7. Underwriting-funded open access
   - A funder can underwrite open agent access to a defined scope of place,
     issue, or dataset.
   - Requests within an underwritten scope bypass the paid quota while remaining
     metered and attributed to the sponsor.
   - Underwritten surfaces carry plain sponsor disclosure and the same
     provenance and safety rules as paid access.

8. Payment-protocol readiness
   - The metered-access boundary advertises its limit and upgrade path through
     one isolated challenge point.
   - The boundary is built to later emit a standards-based payment-required
     response (HTTP 402 / x402) without changing the access contract or the
     provenance guarantees.
   - Adopting an agent-native payment rail is a change of settlement mechanism,
     never a change of what is free or what carries provenance.

## Data And Interfaces

Metering event fields:

- Workspace id.
- Actor or agent id.
- Surface, API or MCP.
- Route or tool.
- Timestamp.
- Auth type.

Limit challenge fields:

- Limit value.
- Window.
- Current usage.
- Remaining budget.
- Upgrade or purchase URL.
- Retry-after hint.

Usage summary fields:

- Included quota and consumption.
- Overage and credit balance.
- Breakdown by surface, route, and day.
- Verified-agent status.

Credit ledger fields:

- Workspace id.
- Granted credits and source.
- Debited credits per call.
- Remaining balance.

Underwriting scope fields:

- Sponsor identity and disclosure text.
- Scope of place, issue, or dataset.
- Metered usage attributed to the sponsor.

## UX And DX Requirements

- Usage and limits read as honest facts, never as pressure tactics.
- Over-limit responses are actionable and plain, and always name the upgrade or
  purchase path.
- Docs explain metering, quotas, credits, verified-agent identity, and
  acceptable use before pricing.
- Examples show how to read provenance and usage restrictions, not only names.
- Internal errors, raw HTTP detail, and stack traces never surface to the
  caller; messages stay safe and generic.
- Billing and contract changes produce a changelog entry and, when breaking,
  migration notes.

## Safety And Acceptable Use

- Payment buys speed, scale, workflow, and service, never exclusivity,
  safety-gate exceptions, or preferential political treatment.
- Metered or underwritten access does not exempt a caller from safety,
  provenance, or use-policy rules.
- Access can be limited or revoked for restricted or harmful use regardless of
  payment.
- Integrations must not market Atlas data as targeting, surveillance, or
  opposition-research datasets.
- Bulk consumption of organizer contact details and locations is rate-limited,
  identity-gated, and monitored for harvest patterns.
- Underwriting never buys influence over what the graph says or how records are
  ranked.

## Metrics

- Metered call volume by surface and workspace.
- Quota, overage, and over-limit challenge events.
- Conversion from free to metered access or credit purchase.
- Credit consumption and remaining balances.
- Underwritten-scope usage and sponsor attribution.
- Provenance-field inclusion in downstream integrations.
- Harvest and abuse events blocked at the metered boundary.

## Acceptance Criteria

- Unauthenticated light-use reads succeed with full provenance and are never
  gated.
- Every external API and MCP call is recorded per workspace.
- Over-limit requests return a structured challenge with limit, usage, and
  upgrade path, and lose no provenance.
- Authenticated and verified agents receive higher budgets than anonymous
  callers.
- Every metered payload carries source metadata, confidence, freshness, review
  state, and usage restrictions.
- Underwritten-scope requests bypass the paid quota, stay metered, and show
  sponsor disclosure.
- Prepaid credits debit correctly and settlement runs in fiat.
- The payment-challenge boundary is isolated so a future HTTP 402 response is a
  settlement change, not a contract change.
