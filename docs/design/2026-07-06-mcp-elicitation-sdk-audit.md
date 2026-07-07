# MCP Elicitation SDK Audit

**Date:** July 6, 2026

**Purpose:** Record the protocol and SDK assumptions behind Atlas's MCP
elicitation rollout so implementation choices stay tied to user experience,
security, and fallback behavior.

## End-User Outcome

Atlas should ask for missing context only when it makes the answer more useful
to the person doing civic research. A broad MCP search that would otherwise
return generic results can ask for a place or search phrase. A sensitive setup
flow must use URL mode so credentials, payments, and third-party OAuth tokens do
not pass through the MCP client or LLM context.

If a client cannot support the relevant elicitation mode, Atlas keeps the
existing safe behavior: read tools continue with safe defaults or explicit
errors, and sensitive flows must point the user to Atlas directly rather than
asking for secrets in-band.

## Official MCP References Checked

Rechecked against `https://modelcontextprotocol.io/llms.txt` on July 7, 2026.

- Documentation index: `https://modelcontextprotocol.io/llms.txt`
- Elicitation spec:
  `https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation.md`
- Lifecycle and capability negotiation:
  `https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle.md`
- Authorization:
  `https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization.md`
- Security best practices:
  `https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices.md`
- Extension support matrix:
  `https://modelcontextprotocol.io/extensions/client-matrix.md`
- Inspector: `https://modelcontextprotocol.io/docs/tools/inspector.md`
- Tasks extension:
  `https://modelcontextprotocol.io/extensions/tasks/overview.md`
- Apps extension: `https://modelcontextprotocol.io/extensions/apps/overview.md`
- Logging:
  `https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/logging.md`
- Pagination:
  `https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination.md`

## SDK Findings

The installed Python MCP SDK has first-class elicitation primitives:

- `mcp.types.ClientCapabilities.elicitation`
- `mcp.types.ElicitationCapability.form`
- `mcp.types.ElicitationCapability.url`
- `mcp.types.ElicitRequest`
- `mcp.types.ElicitRequestFormParams`
- `mcp.types.ElicitRequestURLParams`
- `mcp.types.ElicitResult`
- `mcp.types.ElicitCompleteNotification`
- `mcp.types.ElicitationRequiredErrorData`
- `mcp.shared.exceptions.UrlElicitationRequiredError`
- `mcp.server.session.ServerSession.elicit_form`
- `mcp.server.session.ServerSession.elicit_url`
- `mcp.server.session.ServerSession.send_elicit_complete`
- `mcp.server.fastmcp.server.Context.elicit`
- `mcp.server.fastmcp.server.Context.elicit_url`

FastMCP can inject `Context` into tool functions through type annotations. That
context exposes the active request context and server session, which means Atlas
can send `elicitation/create` requests during a tool call without replacing
FastMCP or hand-writing JSON-RPC plumbing.

The current SDK's high-level form helper validates Pydantic schemas and allows
primitive fields plus sequences of strings. Atlas also keeps lower-level schema
builders for explicit JSON Schema validation because the MCP spec supports forms
with richer enum presentation than the high-level helper exposes.

## Capability Negotiation Finding

Atlas already has a precedent for per-request client capability negotiation in
the draft Tasks support. Tasks reads
`_meta.io.modelcontextprotocol/clientCapabilities` from request parameters
before enabling the extension path.

For elicitation, Atlas uses the same metadata key:

```json
{
  "_meta": {
    "io.modelcontextprotocol/clientCapabilities": {
      "elicitation": {
        "form": {},
        "url": {}
      }
    }
  }
}
```

An empty `elicitation` object means form-mode support for backwards
compatibility with the MCP elicitation spec. URL mode requires an explicit `url`
capability.

## Client Support Matrix Finding

The official extension support matrix is community-maintained and currently
tracks official extensions such as MCP Apps and authorization extensions. It
does not provide a canonical matrix for core elicitation mode support.

That means Atlas must treat elicitation support as a runtime capability, not a
client-name lookup. The product should not say "Claude Desktop supports this" or
"Codex supports this" unless Atlas verifies the active request metadata or a
separate client-specific QA pass proves it.

## Atlas Implementation Decision

Phase 0 introduced a small `atlas.platform.mcp.elicitation` module that keeps
protocol rules testable:

- detect form and URL mode support from request metadata;
- preserve the empty-object form-mode compatibility rule;
- validate form-mode schemas against Atlas's safety subset;
- reject secret-like form field names;
- build SDK-native form and URL elicitation request objects;
- provide a first read-flow clarification policy for broad `search_entities`
  requests and place-scoped entity lookups.

Phase 1 wires the lowest-risk read flows:

- a first-page `search_entities` call with no place, issue area, text, entity
  type, or source type can ask for a place, search phrase, issue area, actor
  type, result depth, and whether to prioritize results with more public sources
  if the client declares form support;
- `get_place_entities` can keep the place fixed while asking for issue area,
  actor type, and result depth when the request is otherwise broad;
- `resolve_issue_areas` can ask the user to choose taxonomy-backed issue slugs
  when multiple returned matches are plausible;
- place-first read tools can ask for a specific place when the submitted place
  is deterministically ambiguous, such as `Kansas City`, `Portland`,
  `Springfield`, or `Washington` without a state or qualifier.

Accept applies the submitted values. Decline or cancel preserves the existing
read behavior.

Phase 2 wires discovery-run preflight onto `start_discovery_run` for clients
that declare form elicitation support. The preflight asks the user to confirm
before Atlas uses a monthly research run. Accepted preflight can amend
`location_query`, `state`, `issue_areas`, `research_goal`, and `search_depth`
before normal validation, idempotency, budget reservation, run creation, and
usage-event recording happen. Decline, cancel, invalid preflight content, or an
unchecked confirmation returns a tool-level "Discovery run not started" outcome
and creates no run, job, budget reservation, cost record, or usage event.

Unsupported clients keep the existing `start_discovery_run` behavior: valid
calls proceed through the current Tasks path and invalid calls return the
existing validation error.

Phase 3 starts adaptive prompts by resolving missing required prompt arguments
in `prompts/get` before FastMCP's static validation runs. When a client declares
form elicitation support and an active request context is available, Atlas can
ask for the missing `place`, `query`, `entity`, or `run_id` needed by the
selected prompt. Accepted values are trimmed and applied before the prompt is
rendered. Decline, cancel, unsupported clients, or missing request context keep
the existing static prompt behavior and surface the same Invalid params errors
for missing required arguments. For `inspect_source_trail` and
`create_research_brief`, clients can include actor or completed-run candidates
in request metadata so the missing `entity` or `run_id` prompt is a titled
single-select choice instead of a blank text field.

Phase 3 also adds optional prompt-context elicitation after required arguments
are satisfied. `research_place` and `assess_coverage_gaps` can ask for an issue
focus, and `find_civic_actors` can ask for place and evidence threshold when the
prompt is otherwise broad. Accepted optional values are rendered into the prompt
text; decline or cancel keeps the prompt usable with the arguments already
provided.

Phase 4 starts Workbench write handoffs with the existing saved-list, brief,
coverage target, and watch surfaces. The `save_entities_to_list` MCP tool
accepts a target list id, selected actor ids, and an optional note, then
requires form-mode confirmation before writing. The `create_research_brief` MCP
tool accepts a title, scope, summary, linked actors, linked sources, linked
discovery runs, confidence summary, and gaps, then confirms workspace visibility
and evidence linkage before creating a private brief. The
`export_research_brief` MCP tool confirms export intent before returning a
structured private brief export with linked evidence IDs and provenance counts.
The `create_coverage_target` MCP tool accepts typed workspace target fields,
confirms workspace visibility, review-state, and evidence linkage through form
mode, validates linked evidence, and records a privacy-safe
`coverage_target_created` usage event. The `export_coverage_report` MCP tool
confirms export intent before returning the active workspace coverage report
with target gaps, next actions, evidence counts, and provenance summary. The
`watch_workspace_resource` MCP tool accepts typed resource and notification
choices, confirms the watch through form mode, verifies that the target is
watchable in the active workspace, and records the same privacy-safe usage event
as the first-party app. The `sync_scout_artifacts` MCP tool accepts the same
canonical Scout artifact bundle used by the REST sync endpoint, confirms that
the run has been reviewed, and syncs it privately to the active workspace with
source links and entry visibility receipts intact. Unsupported clients, decline,
cancel, missing identity, missing ownership, or missing resources do not create
public records or infer intent. Accepted writes use the same saved-list, brief,
coverage target, Scout sync, and workspace watch tables as the first-party app
and API, so source receipts, private briefs, coverage targets, synced runs, and
watch state remain visible in existing Workbench surfaces.

Phase 5 starts URL-mode sensitive flows with first-party account settings
handoffs. The `open_billing_settings` and `open_api_key_settings` MCP tools
check URL-mode capability, create short-lived server-side elicitation state,
bind that state to the MCP user and workspace identity when available, and ask
the client for consent to open the first-party Atlas account page. The
elicitation URL contains only the opaque elicitation id. It does not contain
credentials, payment data, user identity, workspace id, or submitted form
content. Unsupported clients receive a safe instruction to open Atlas account
settings directly instead of a URL-mode request, and unavailable handoffs return
a generic account-settings message rather than exposing server configuration
details.

The `/account` page completes URL-mode handoffs by calling the first-party
`POST /api/mcp/elicitations/{elicitation_id}/complete` endpoint after an Atlas
browser session exists. The endpoint verifies that the browser actor matches the
MCP user and workspace bound to the original elicitation id, returns `404` for
unknown, expired, completed, or mismatched elicitations, and sends a best-effort
MCP completion notification to the initiating request session when the SDK
session exposes that capability.

Atlas now also uses a typed `URLElicitationRequiredError` for blocking API-key
setup. It emits JSON-RPC code `-32042` with `data.elicitations` limited to
URL-mode elicitation requests that include an `elicitationId`. Direct billing
and API-key settings requests still complete through direct URL-mode
elicitation, while `require_api_key_settings` uses the error path because the
agent cannot continue until the account-page handoff is completed and the
original request is retried.

Phase 6 rollout controls are implemented as environment-backed settings:
`ATLAS_MCP_FORM_ELICITATION_ENABLED`, `ATLAS_MCP_URL_ELICITATION_ENABLED`, and
`ATLAS_MCP_WORKBENCH_HANDOFFS_ENABLED`. These default on to preserve the shipped
assistant experience, but operators can disable form-mode follow-up questions,
URL-mode browser handoffs, or MCP-originated Workbench writes independently.
Disabling form mode makes Atlas behave as if the client did not declare form
support. Disabling URL mode stops the billing handoff before any URL elicitation
request is sent. Disabling Workbench handoffs returns a typed disabled response
from the write tools before any saved-list, coverage-target, or watch write is
attempted.

URL-mode completion also logs privacy-safe support events for expired browser
handoffs, repeated completion attempts, and browser identity mismatches. Those
events explain why a handoff did not finish without recording elicitation IDs,
user IDs, submitted form content, credentials, or browser session contents.
Operator triage, abuse review, and rollback steps are captured in
[`docs/runbooks/mcp-elicitation-support.md`](../runbooks/mcp-elicitation-support.md).

## Security Decisions

Form mode must never request secrets, credentials, tokens, API keys, payment
credentials, OAuth authorization codes, or private proof documents. Atlas
enforces this at schema-construction time by rejecting secret-like field names.

Elicitation lifecycle logs must be useful to MCP clients and operators without
exposing submitted values. Atlas logs the interaction, mode, action, and safe
next step with a human-readable status message. It does not log place names,
queries, issue selections, run ids, private notes, raw prompt arguments, or form
content.

URL mode is reserved for sensitive flows and must use HTTPS in non-development
environments, show the target domain to the user through the MCP client, bind
the elicitation id to the authenticated Atlas user, and verify that the browser
session completing the flow belongs to the same user that initiated it. The
account-settings handoffs now implement that identity check and completion
notification bridge for a first-party page. Atlas should not add MCP handoffs
for third-party connectors, profile stewardship, or private proof until those
flows exist as trusted first-party user experiences that can reuse this
identity-binding contract.

## Fallback Contract

Unsupported form mode:

- `search_entities` keeps the original arguments and returns the ordinary
  result.
- Future read tools may return explicit missing-input errors when a safe default
  would be misleading.

Unsupported URL mode:

- Atlas must not downgrade to form mode.
- The tool should return a safe instruction to open Atlas directly or a
  URL-elicitation-required error only when the client has declared URL support.

Decline:

- Treat as an explicit user decision and continue only when a safe alternative
  exists.

Cancel:

- Treat as dismissal. Do not infer intent. Preserve the existing request where
  that is safe; otherwise stop the action.

## Verification Added

Targeted tests now cover:

- malformed and missing client capability metadata;
- form-mode compatibility for empty `elicitation` capability objects;
- explicit form and URL support;
- SDK `ClientCapabilities` models;
- safe and unsafe form schemas;
- secret-like form fields;
- generic secret-field blocker logging without rejected field names;
- form and URL request builders;
- broad-search clarification decisions;
- ambiguous-place clarification decisions;
- accept, decline, unsupported-client, and unavailable-context behavior;
- `search_entities` and place-first read tools keeping the injected FastMCP
  context out of the public tool input schema.
- discovery-run preflight accept, decline, cancel, unsupported-client, invalid
  response, and handler short-circuit behavior before task creation.
- adaptive prompt missing-argument accept, decline, unsupported-client, and
  no-request-context fallback behavior.
- URL-mode billing settings unsupported-client, accept, decline, first-party URL
  construction, server-side state binding, and expiry behavior.
- first-party URL completion endpoint behavior for successful completion,
  identity mismatch, unknown ids, expired ids, reused ids, and tampered ids.
- direct-client smoke coverage for form-capable clients, unsupported clients,
  and URL-mode browser handoffs without requiring an external MCP Inspector
  session in local development.
