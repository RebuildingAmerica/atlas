# Platform admin controls: switches, account lookup, rollout

Status: design, 2026-10-09. Covers the three platform features left in I7 of the
admin separation plan. Editorial features (takedowns, activity, schedules)
shipped in the end app.

## Why these exist

Today, stopping discovery spend or pausing sales means editing a GitHub variable
and shipping a release, and answering "what does this workspace have?" means SQL
against production. Both are slow when something is going wrong, and SQL is the
one tool where a typo hurts a customer. The operator is one person; every
control below has to be safe to use alone, late, and tired.

## 1. Switches (kill switches and sales pause)

**What the operator sees.** A Switches page in the platform admin listing two
switches, each with its state, who last changed it, when, and why:

- _Discovery spend_: when engaged, no discovery run may spend money, the same as
  `DISCOVERY_COST_KILL_SWITCH` today.
- _Checkout_: when engaged, the pricing page stops offering checkout and says
  sales are paused, the same as `ATLAS_BILLING_CHECKOUT_ENABLED=false` today.

Changing a switch asks for a reason and a confirmation. The change takes effect
within a minute without a release.

**How.**

- API table
  `platform_switches(name PRIMARY KEY, engaged, reason, changed_by, changed_at)`,
  plus an append-only history through the existing audit log.
- Platform routes `GET /api/platform/switches` and
  `PUT /api/platform/switches/{name}` under new actions `platform.switches.read`
  and `platform.switches.write`, mounted only when managed.
- `assert_within_budget` refuses when either the env flag or the discovery
  switch is engaged. The env flag stays as the break-glass that works with the
  database down.
- The app reads a public `GET /api/service-status` (`{checkout_open}`), cached
  for 30 seconds like the catalog probe, and offers checkout only when both
  `ATLAS_BILLING_CHECKOUT_ENABLED` and `checkout_open` say yes. A failed probe
  closes checkout rather than opening it.

**Not doing.** Arbitrary switches, scheduled switches, per-workspace switches.

## 2. Account and workspace lookup

**What the operator sees.** A Lookup page: type an email or workspace slug, see
the account, its workspaces and roles, the products each workspace holds and why
(purchase, discount, grant), recent purchases and refunds, and open discount
requests. Read-only first.

**How.** Accounts live in the app's Better Auth database, not the API's, so the
API asks the app over the existing callback channel:
`POST /api/auth/internal/platform-lookup` (callback secret), returning the
account and memberships. The platform route `GET /api/platform/lookup?q=`
(action `platform.accounts.read`) joins that with the API's own purchase, grant
and discount records. Every lookup is audited, because reading a customer's
account is itself sensitive.

**Product grants (decision needed).** Granting a workspace a product without
payment changes what a customer receives and what Atlas earns. This needs a
written policy first: who qualifies, for how long, whether grants expire, and
whether the customer is told. Until the policy exists, lookup stays read-only
and grants are not built.

## 3. Feature rollout

**What the operator sees.** A Rollout page listing named features, each off, on
for listed workspaces, or on for everyone.

**How.** Atlas has no flag system and no feature waiting for one. Building the
mechanism before a feature needs it would be complexity without an experience.
The first feature that needs a staged rollout adds a
`platform_features(name, mode, workspace_ids)` table, a platform route under
`platform.features.write`, and a server-side check the app and API share. Until
then this section is the plan of record, not code.

## Order

1. Switches: the fastest relief when something goes wrong.
2. Read-only lookup: replaces production SQL.
3. Grants, after the policy is written.
4. Rollout, with its first feature.
