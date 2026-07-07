# MCP Elicitation Support And Abuse Runbook

[Docs](../README.md) > [Runbooks](./mcp-elicitation-support.md) > MCP
Elicitation Support And Abuse

Use this runbook when an Atlas assistant connection asks a user for
clarification, confirmation, or browser consent and the user cannot continue, a
workspace admin asks what happened, or an operator needs to review potential
abuse.

## User-Visible Outcome First

Start with the user impact:

- The assistant could not continue a civic research request.
- A workspace action did not happen.
- A research run did not start.
- An account handoff did not complete.
- A user saw repeated or confusing follow-up requests.

Do not start from protocol internals. Translate the incident into the action the
user expected to complete.

## Privacy Boundary

Operators may inspect privacy-safe lifecycle metadata only:

- interaction name
- mode: `form` or `url`
- action: `requested`, `accepted`, `declined`, `canceled`, `unsupported`,
  `expired`, `completed`, `identity_mismatch`, `unavailable`, or
  `already_completed`
- next step
- timestamp and environment context from the logging platform

Operators must not ask for, copy, or store:

- submitted form content
- raw prompts or private notes
- API keys, passwords, access tokens, payment details, or private keys
- browser session contents
- elicitation URLs from user screenshots when they include query strings
- user or workspace identifiers copied out of private systems into support notes

If a user sends a screenshot or log that contains secrets, ask them to revoke
the secret in the relevant service, then replace the support artifact with a
redacted summary.

## Fast Triage

1. Identify the user-visible flow:
   - read clarification
   - discovery-run preflight
   - guided research starter
   - Workbench handoff
   - account browser handoff
2. Ask whether the user clicked accept, decline, canceled the request, or never
   saw a prompt.
3. Check whether the client supports the required interaction mode.
4. Check whether the corresponding rollout flag is enabled:
   - `ATLAS_MCP_FORM_ELICITATION_ENABLED`
   - `ATLAS_MCP_URL_ELICITATION_ENABLED`
   - `ATLAS_MCP_WORKBENCH_HANDOFFS_ENABLED`
5. Check privacy-safe lifecycle logs for the interaction and action.
6. Give the user the safe next step from the sections below.

## Read Clarification

Common user report: the assistant searched the wrong place, issue area, actor
type, or evidence depth.

Checks:

- Look for `requested` followed by `accepted`, `declined`, `canceled`, or
  `unsupported`.
- If the action is `unsupported`, the client did not declare form-mode
  elicitation. The assistant should continue with the ordinary read path when a
  safe default exists.
- If the action is `declined`, Atlas uses the safe fallback. That is expected.
- If the action is `canceled`, Atlas should stop the clarification path without
  turning the cancellation into another action.

Safe user response:

- Ask the user to restate the place, issue area, actor type, or evidence
  threshold in the next assistant message.
- For ambiguous places, suggest including state or region, for example
  `Kansas City, MO`.

Do not inspect or reconstruct the user's original prompt from logs.

## Discovery-Run Preflight

Common user report: a research run did not start.

Checks:

- Look for `discovery_run_preflight`.
- `accepted` means Atlas may proceed to task creation.
- `declined`, `canceled`, `unsupported`, or invalid content means Atlas must not
  create a run, job, budget reservation, or cost record.
- If the user expected a run after declining or canceling, explain that Atlas
  treats those as consent boundaries.
- If the workspace hit a budget limit, use the existing discovery budget support
  path instead of treating it as elicitation failure.

Safe user response:

- Ask the user to retry and explicitly confirm the run if they still want fresh
  research.
- If existing coverage is enough, suggest asking the assistant to use
  `list_discovery_runs`, `get_discovery_run`, or ordinary search results.

## Workbench Handoffs

Common user report: saved actors, coverage targets, watches, briefs, exports, or
Scout syncs did not appear in the workspace.

Checks:

- Confirm `ATLAS_MCP_WORKBENCH_HANDOFFS_ENABLED=true`.
- Look for the relevant Workbench interaction and action.
- `unsupported`, `declined`, or `canceled` means no workspace write should have
  happened.
- Successful writes should create normal Workbench records and a privacy-safe
  usage event with empty or redacted metadata.
- Missing ownership, missing resource, or missing workspace identity should stop
  the write without creating partial records.

Safe user response:

- Ask the user to retry from the assistant and accept the confirmation.
- If the client does not show confirmations, use Atlas directly for the
  workspace action.

Do not ask the user to paste private notes or raw assistant context into a
support ticket.

## Account Browser Handoffs

Common user report: the browser opened but the assistant still cannot continue.

Checks:

- Confirm `ATLAS_MCP_URL_ELICITATION_ENABLED=true`.
- Confirm the URL shown by the client uses the Atlas origin and contains only
  the opaque `mcpElicitationId` query parameter.
- Look for account handoff lifecycle actions:
  - `requested`: Atlas asked the client for browser consent.
  - `accepted`: the user consented to open the Atlas page.
  - `completed`: the account page verified the browser session and completed the
    handoff.
  - `expired`: the user waited too long; start a new handoff.
  - `already_completed`: the handoff was reused; start a new handoff if needed.
  - `identity_mismatch`: the browser session did not match the MCP user or
    workspace.
  - `unavailable`: Atlas could not notify the initiating client; manual retry is
    still available.
- Unknown, expired, reused, or mismatched handoff IDs intentionally return the
  same not-found response to avoid leaking internal state.

Safe user response:

- Ask the user to sign in to Atlas with the same account and workspace they used
  for the assistant connection.
- Ask the user to retry the original assistant request after completing the
  browser page.
- If notification was unavailable, ask the user to retry manually; do not
  describe it as data loss.

Do not ask the user to send the full handoff URL. If support needs to confirm
domain safety, ask only for the displayed host.

## Abuse Review

Review for abuse when one user, client, workspace, or IP range repeatedly
triggers:

- form requests that users decline or cancel in loops
- URL handoffs that never complete
- browser identity mismatches
- unsupported-client fallback loops that keep retrying the same write
- secret-field blocker events
- attempts to turn private account setup into in-client form collection

Operator actions:

1. Preserve the privacy boundary. Review lifecycle counts and safe interaction
   names, not private prompts or submitted form values.
2. If the pattern is client-specific, ask the user to disconnect and reconnect
   the MCP client, then retry once.
3. If the pattern is workspace-specific and disruptive, disable the narrowest
   rollout flag first:
   - URL browser handoffs: `ATLAS_MCP_URL_ELICITATION_ENABLED=false`
   - form follow-up questions: `ATLAS_MCP_FORM_ELICITATION_ENABLED=false`
   - Workbench writes: `ATLAS_MCP_WORKBENCH_HANDOFFS_ENABLED=false`
4. If abuse affects public API availability, follow
   [Anonymous API Rate Limits](./rate-limits.md).
5. File an internal incident note with:
   - user-visible impact
   - affected flow
   - safe lifecycle counts
   - rollout flag changes
   - customer communication sent

Do not include raw prompts, submitted form content, secrets, handoff IDs, or
full URLs in the incident note.

## Rollback

Use the smallest rollback that protects users:

| Symptom                                          | First rollback                                       |
| ------------------------------------------------ | ---------------------------------------------------- |
| Follow-up questions confuse users                | `ATLAS_MCP_FORM_ELICITATION_ENABLED=false`           |
| Browser handoffs fail or loop                    | `ATLAS_MCP_URL_ELICITATION_ENABLED=false`            |
| Workspace writes are creating unexpected records | `ATLAS_MCP_WORKBENCH_HANDOFFS_ENABLED=false`         |
| Discovery runs start without clear user intent   | Disable form mode and investigate preflight tests    |
| Logs contain private content or identifiers      | Disable affected phase and treat as privacy incident |

After rollback, verify that read-only assistant requests still work and that
state-changing requests fail closed with plain user-facing messages.

## Verification Commands

Run these before declaring a support fix ready:

```bash
cd api
uv run --extra dev pytest -o addopts='' \
  tests/platform/test_mcp_elicitation.py \
  tests/platform/test_mcp_server.py \
  tests/platform/test_mcp_prompts.py \
  tests/platform/test_mcp_tasks.py \
  tests/platform/test_mcp_workbench.py \
  tests/domains/access/test_mcp_elicitations_api.py \
  tests/domains/access/test_org_usage_api.py -q

cd ../app
pnpm vitest run tests/unit/domains/access/pages/account-page.test.tsx
pnpm tsc --noEmit
```

If public docs changed, also run:

```bash
cd app
pnpm exec prettier --check ../mintlify/mcp/*.mdx ../mintlify/mcp/tutorials/*.mdx
```
