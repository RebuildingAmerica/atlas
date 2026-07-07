# MCP Elicitation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt MCP elicitation in Atlas so assistant users can clarify civic
research intent, confirm budgeted research runs, safely hand results into
Workbench workflows, and complete sensitive setup through URL-mode flows without
losing provenance or weakening trust boundaries.

**Architecture:** Add elicitation as a capability-gated interaction layer around
the existing Atlas MCP server. Keep read-flow elicitation small and
schema-driven, keep `start_discovery_run` task-based with a preflight decision,
and route sensitive third-party or payment flows through identity-bound URL-mode
connect pages. Preserve the current OAuth, workspace, Tasks, logging, Apps,
usage activity, and provenance contracts.

**Tech Stack:** FastAPI, Python 3.12, FastMCP/Python MCP SDK, async
`aiosqlite`/PostgreSQL-compatible SQL, Pydantic, TanStack Start, Better Auth,
TanStack Query, Orval, Vitest, Pytest, Playwright where UI flows are added,
existing Atlas MCP tools/prompts/tasks/widgets, OAuth protected-resource
metadata, workspace usage events, discovery budgets, and Workbench APIs.

**Implementation status as of July 6, 2026:** Phase 0 and the first production
slices of Phase 1 and Phase 2 are implemented. Atlas now has shared elicitation
helpers, safe schema validation, form/url capability detection, broad
`search_entities` clarification, issue-area/actor-type/result-depth narrowing
for broad reads, source-backed result prioritization when the user asks for a
stronger evidence posture, deterministic ambiguous-place clarification for
place-first read tools, place-scoped narrowing for `get_place_entities`, and
taxonomy-backed `resolve_issue_areas` selection when resolver matches are
ambiguous. `start_discovery_run` has form-mode preflight before budget
reservation for clients that declare form elicitation support. Phase 3 prompt
elicitation now resolves missing required prompt arguments and can ask for
optional issue focus, place, and evidence-threshold context for broad
`research_place`, `find_civic_actors`, and `assess_coverage_gaps` prompts before
static prompt rendering. `inspect_source_trail` and `create_research_brief` can
also present client-provided actor or completed-run candidates as titled choices
when their required argument is missing. Phase 5 URL-mode flows are implemented
for opening Atlas billing and API-key settings through first-party URL consent
with short-lived server-side state, browser-session identity confirmation, and
best-effort completion notification back to the initiating MCP client session.
Atlas also uses `URLElicitationRequiredError` for API-key setup flows that
cannot continue until the account-page handoff is completed and retried.
Additional sensitive flows should only be added when Atlas ships the
corresponding first-party user surface; SSO is intentionally outside the MCP
elicitation scope. Phase 6 rollout controls now exist for form-mode elicitation,
URL-mode elicitation, and MCP-originated Workbench handoffs through
`ATLAS_MCP_FORM_ELICITATION_ENABLED`, `ATLAS_MCP_URL_ELICITATION_ENABLED`, and
`ATLAS_MCP_WORKBENCH_HANDOFFS_ENABLED`; URL-mode completion now emits
privacy-safe lifecycle events for expired handoffs, repeated completions, and
browser identity mismatches; public docs are updated around shipped behavior.

---

## Reference Documents

Read these before implementation:

- `AGENTS.md`
- `docs/experience-first.md`
- `docs/the-atlas-product.md`
- `docs/product/mcp-elicitation-strategy.md`
- `docs/product/prds/13-developer-api-mcp-open-data-prd.md`
- `docs/product/prds/15-governed-agent-access-and-metering-prd.md`
- `docs/product/trust-safety-verification-system.md`
- `mintlify/mcp/overview.mdx`
- `mintlify/mcp/tools.mdx`
- `mintlify/mcp/prompts.mdx`
- `mintlify/workspace/customer-workflow.mdx`
- `mintlify/api/guides/workspace.mdx`
- `api/atlas/platform/mcp/server.py`
- `api/atlas/platform/mcp/tasks.py`
- `api/atlas/platform/mcp/prompts.py`
- `api/atlas/platform/mcp/auth_middleware.py`
- `api/atlas/platform/mcp/logging_support.py`
- `api/atlas/platform/mcp/widgets.py`
- `app/src/domains/access/oauth-as-metadata.ts`
- MCP docs index: `https://modelcontextprotocol.io/llms.txt`
- MCP elicitation spec:
  `https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation.md`
- MCP lifecycle/capabilities:
  `https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle.md`
- MCP authorization:
  `https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization.md`
- MCP security best practices:
  `https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices.md`
- MCP client extension support matrix:
  `https://modelcontextprotocol.io/extensions/client-matrix.md`

## Product Contract

Atlas elicitation is successful only when it improves a visible user outcome. It
must help a user find better civic actors, understand the evidence threshold,
confirm a budgeted action, preserve workspace boundaries, or complete a
sensitive external flow safely.

The first implementation must not turn every MCP tool into a form. The smallest
useful decision wins. If the assistant can safely answer with existing data,
Atlas should not interrupt.

Form mode is allowed for non-sensitive structured decisions. URL mode is
required for secrets, credentials, access tokens, payment credentials,
third-party OAuth, sensitive connector setup, private identity proof, and
profile-claiming flows that require private evidence.

Decline and cancel are first-class outcomes. Decline should route to an
alternative when available. Cancel should stop the elicited action without
assuming intent.

## Phase 0: Capability Audit And Protocol Spike

**User outcome:** Atlas knows which clients can support elicitation before
shipping behavior that would silently fail or confuse users.

**Implementation scope:**

- Audit the installed Python MCP SDK for server-to-client `elicitation/create`
  support and capability inspection.
- Use MCP Inspector or direct JSON-RPC tests to verify how the current Atlas
  server sees client initialization capabilities.
- Create a client support matrix covering Claude Desktop, Claude Code, VS Code
  with Copilot, Gemini CLI, Codex CLI, Copilot CLI, and MCP Inspector for: form
  elicitation, URL elicitation, Tasks, logging, Apps, and remote OAuth.
- Decide the fallback contract for unsupported clients:
  - read tools continue with safe defaults or return an actionable missing input
    error;
  - `start_discovery_run` can return a tool-level error naming the missing
    confirmation;
  - URL-only sensitive flows return a safe instruction to open Atlas directly.
- If the SDK lacks the needed support, design a small low-level JSON-RPC shim
  following the existing Tasks pattern instead of replacing FastMCP.

**Acceptance criteria:**

- A checked-in audit note or implementation spike summary identifies SDK
  support, unsupported gaps, and fallback behavior.
- Tests prove Atlas does not send unsupported elicitation modes to clients.
- No user-facing behavior changes ship in this phase unless they are behind a
  disabled feature flag.

**Verification:**

- Run targeted MCP tests for initialization and capability handling.
- Run existing API MCP tests.
- Confirm docs links in the support matrix are current against the official MCP
  docs index.

## Phase 1: Form-Mode Read Clarification

**User outcome:** Assistant users get better source-linked answers because Atlas
clarifies ambiguous place, issue, actor, and evidence choices before searching.

**Implementation scope:**

- Add shared MCP elicitation utilities:
  - capability check helpers;
  - form request builder;
  - restricted schema validator;
  - accept/decline/cancel result mapper;
  - secret-field blocker;
  - privacy-safe logging hooks.
- Add read-flow clarification only where ambiguity materially changes the
  result:
  - ambiguous place names such as Kansas City, Portland, Springfield, or
    Washington;
  - broad issue text where `resolve_issue_areas` returns multiple plausible
    high-ranking slugs;
  - unclear actor scope, especially "people" versus all civic actors;
  - evidence threshold when the prompt implies outreach, publication, funding,
    or other high-stakes use.
- Keep the first schemas small:
  - `place`;
  - `issue_areas`;
  - `actor_types`;
  - `evidence_threshold`;
  - `result_depth`.
- Apply clarification to `search_entities`, `get_place_entities`,
  `get_place_coverage`, `get_place_issue_signals`, and `resolve_issue_areas`
  where relevant.
- Preserve current behavior for unsupported clients.

**Acceptance criteria:**

- Atlas elicits only when a deterministic ambiguity detector fires.
- Form schemas are flat and contain no secret-like fields.
- Decline returns a normal read path when safe.
- Cancel stops the clarification path without starting a different action.
- Tool responses still include source metadata, trust context, and pagination.

**Verification:**

- Unit tests for ambiguity detection and schema building.
- Unit tests for secret-field blocking.
- MCP protocol tests for accept, decline, cancel, unsupported client, and
  invalid returned content.
- Existing API and MCP tests remain passing.

## Phase 2: Discovery Run Preflight

**User outcome:** Users intentionally start budgeted research runs with the
right place, issue set, and research goal.

**Implementation scope:**

- Add preflight elicitation before `start_discovery_run` when any of these are
  true:
  - state is missing or ambiguous;
  - issue areas are missing, broad, or unresolved;
  - research goal is missing;
  - the request would spend a monthly discovery run;
  - existing coverage may answer the question without a new run.
- Keep the existing Tasks behavior after acceptance. The accepted preflight
  should create the same task handle users receive today.
- Include budget context in plain copy when monthly run count matters.
- Treat decline as "do not start the run" and offer existing search/coverage
  alternatives where possible.
- Treat cancel as "no run started."
- Do not change the public `start_discovery_run` input schema unless the
  implementation proves it is necessary.

**Acceptance criteria:**

- No discovery run, job, budget reservation, or cost record is created before
  preflight acceptance.
- Accepted preflight creates exactly one run/task for the confirmed inputs.
- Decline and cancel create no run/task and return non-misleading tool output.
- Existing budget-exceeded behavior remains intact.
- Idempotency behavior still prevents duplicate runs for equivalent confirmed
  inputs.

**Verification:**

- Unit tests around preflight-required and preflight-not-required cases.
- Integration tests for accept, decline, cancel, unsupported client, and budget
  exceeded.
- Task polling tests for accepted runs.
- Existing discovery budget and cost tests remain passing.

## Phase 3: Adaptive MCP Prompts

**User outcome:** Guided Atlas MCP prompts become easier for non-expert users
because missing or ambiguous prompt arguments can be resolved in the flow.

**Implementation scope:**

- Extend prompt handling so prompt templates can request missing information
  when the client supports form elicitation.
- Keep prompts read-only in this phase.
- Add adaptive behavior:
  - `research_place` asks for issue focus when the user wants a narrower
    landscape;
  - `find_civic_actors` asks for place or evidence threshold when the query is
    too broad;
  - `inspect_source_trail` asks the user to choose a candidate entity when
    search returns multiple likely matches;
  - `assess_coverage_gaps` asks whether to assess all issues or a focused set;
  - `create_research_brief` asks which completed run when the requested run is
    ambiguous.
- Maintain prompt pagination and existing invalid-params behavior.

**Acceptance criteria:**

- Prompt elicitation never creates or modifies Atlas data.
- Prompt fallback behavior remains useful for unsupported clients.
- Prompt answers continue to instruct assistants to preserve sources,
  confidence, freshness, and coverage limits.

**Verification:**

- Prompt tests for missing argument, ambiguous argument, accepted elicitation,
  decline, cancel, unsupported client, and pagination.
- Snapshot or string tests for prompt text where the repo already uses them.
- Existing prompt wrapper tests remain passing.

## Phase 4: Workbench Write Handoffs

**User outcome:** Teams can move from MCP-assisted discovery into Workbench
actions without losing sources or accidentally publishing private context.

**Implementation scope:**

- Define MCP write tools only for Workbench actions that already have stable
  app/API equivalents:
  - save selected actors to a working set;
  - create a brief from a discovery run;
  - create a coverage target;
  - watch an actor, source, issue, place, or coverage target;
  - export a brief or coverage report;
  - sync or import reviewed Scout artifacts when the API contract is ready.
- Require form-mode confirmation before each write.
- Include visibility, review state, confidence state, and source linkage in the
  elicited decision.
- Keep private notes out of public records by default.
- Record privacy-safe usage events for successful MCP writes.

**Implementation status as of July 6, 2026:** the first Phase 4 slices are
implemented for saving selected actors to an existing Atlas saved list through
`save_entities_to_list`, creating a private workspace brief through
`create_research_brief`, creating a private workspace coverage target through
`create_coverage_target`, exporting a private workspace brief through
`export_research_brief`, exporting a private workspace coverage report through
`export_coverage_report`, syncing reviewed Scout run artifacts through
`sync_scout_artifacts`, and watching an existing workspace resource through
`watch_workspace_resource`. These tools require form-mode confirmation, keep the
action bound to the authenticated user and workspace, record privacy-safe usage
events, and write nothing for unsupported, declined, or canceled confirmations.
Brief creation, brief export, coverage-target, coverage-report export, Scout
artifact sync, and watch handoffs use typed resource, review-state,
source-linkage, visibility, and notification choices so MCP clients can present
constrained forms instead of free-text write actions.

**Acceptance criteria:**

- Workspace writes require the authenticated workspace and relevant scopes.
- Elicited writes preserve source ids or source URLs.
- Public/private visibility is explicit.
- Decline and cancel write nothing.
- Usage activity remains payload-safe and does not expose prompts, notes, or raw
  metadata.

**Verification:**

- API tests for each new write tool's authorization, validation, and visibility
  behavior.
- MCP tests for accept, decline, cancel, unsupported client, and missing scope.
- App/API contract tests where generated clients are affected.
- OpenAPI and Orval generation when REST schemas change.

## Phase 5: URL-Mode Sensitive Flows

**User outcome:** Users can complete sensitive setup, external authorization, or
payment-related actions through trusted web surfaces without exposing
credentials to the MCP client or LLM context.

**Implementation scope:**

- Add an elicitation state store bound to:
  - elicitation id;
  - MCP user subject;
  - workspace id;
  - client/session identity where available;
  - mode;
  - target flow;
  - expiration;
  - completion state.
- Add Atlas-controlled connect routes for URL-mode flows. These routes must
  verify that the browser session user matches the MCP user who initiated the
  elicitation before redirecting to any third party.
- Start with one low-risk URL-mode pilot before adding many flows. Recommended
  pilot: billing portal or prepaid credits, because it already belongs on a
  first-party web surface and should never expose payment credentials to MCP.
- For the initial billing-settings pilot, complete the flow through a
  first-party endpoint that verifies the authenticated browser actor against the
  MCP user/workspace bound to the elicitation id before marking the elicitation
  complete.
- Do not add URL-mode flows for surfaces Atlas does not actually ship. Future
  third-party connector, profile-stewardship, or private-proof flows must first
  exist as trusted first-party product experiences, then reuse this
  identity-bound handoff pattern.
- Send completion notifications when supported and keep manual retry/cancel
  paths when notifications are missed.
- Implemented protocol support for `URLElicitationRequiredError` payloads and
  the first production use in `require_api_key_settings`, where the agent cannot
  continue until the account-page API-key setup handoff is completed and the
  request is retried.

**Acceptance criteria:**

- URL-mode requests include no secrets or sensitive user data in the URL.
- URLs are HTTPS outside development.
- Connect routes reject identity mismatches.
- Third-party credentials never transit through the MCP client.
- Completion updates only the initiating client/session where protocol support
  allows.
- Manual retry remains available if completion notification is missed.

**Verification:**

- Security tests for identity mismatch, expired elicitation id, reused
  elicitation id, modified URL parameters, and unknown completion id.
- Integration tests for accepted URL-mode flow and declined/canceled flow.
- Browser tests for the Atlas connect page or first-party settings handoff when
  additional UI is added.
- Logging tests proving sensitive URL query strings and credentials are not
  persisted.

## Phase 6: Observability, Docs, And Rollout

**User outcome:** Users and workspace admins understand MCP elicitation
behavior, and Atlas operators can support it without exposing private prompts or
payloads.

**Implementation scope:**

- Add privacy-safe elicitation lifecycle metrics:
  - requested;
  - accepted;
  - declined;
  - canceled;
  - expired;
  - completed;
  - unsupported client fallback;
  - URL identity mismatch;
  - secret-field blocker event.
- Extend workspace integration activity only if the data stays privacy-safe. Do
  not expose prompts, submitted form content, private notes, raw metadata, or
  session replay.
- Add public Mintlify docs only after behavior exists:
  - concise overview of when Atlas asks for more information;
  - client support notes;
  - troubleshooting for missing elicitation support;
  - security explanation for URL-mode sensitive flows.
- Add internal runbooks for support and abuse review.
- Add rollout gates:
  - development flag;
  - internal dogfood;
  - one or two supported clients;
  - Pro/Team beta;
  - broader hosted rollout.

**Implementation status as of July 6, 2026:** lifecycle logging now covers the
core form-mode and URL-mode states shipped so far, including requested,
accepted, declined, canceled, unsupported client fallback, completed browser
handoffs, expired browser handoffs, repeated completion attempts, identity
mismatches, unavailable completion notifications, and secret-field blocker
events for rejected server-authored form schemas. Secret-field blocker events
use generic copy and do not include the rejected field name or schema content.
The internal support and abuse path is documented in
`docs/runbooks/mcp-elicitation-support.md`.

**Acceptance criteria:**

- Operators can diagnose failed elicitation without seeing private content.
- Public docs describe real shipped behavior, not roadmap promises.
- Feature flags allow rollback by phase.
- Metrics show whether elicitation improves search quality and run success.

**Verification:**

- Unit tests for usage-event redaction.
- Docs checks for changed Mintlify pages.
- Repeatable direct-client smoke tests for form-capable, unsupported, and
  URL-mode flows.
- External MCP client smoke should run during supported-client beta QA, after
  the hosted environment and client-specific OAuth setup are available.

## Cross-Phase Engineering Rules

- Do not ask for sensitive information in form mode.
- Do not send unsupported elicitation modes to clients.
- Do not start budgeted or state-changing work before acceptance.
- Do not treat decline or cancel as protocol failure.
- Do not log submitted free-text content by default.
- Do not expose workspace-private context as public evidence.
- Do not remove source metadata, confidence, freshness, review state, or
  visibility from downstream MCP responses.
- Do not add public docs for behavior that is not implemented.

## Suggested Milestone Order

1. Phase 0 audit and SDK spike.
2. Phase 1 read-flow clarification behind a feature flag.
3. Phase 2 discovery-run preflight behind the same flag.
4. Phase 3 adaptive prompts once read-flow helpers are stable.
5. Phase 6 observability basics for Phases 1-3.
6. Phase 4 Workbench write handoffs as stable write tools exist.
7. Phase 5 URL-mode sensitive flow pilot.
8. Phase 6 public docs and broader rollout.

This order protects Atlas's highest-value experience first: a user asking an
assistant who is working on an issue in a place gets clearer, more source-linked
answers with fewer guessed assumptions.

## Documentation-Only Implementation Checklist

The initial docs implementation for this plan is complete when:

- `docs/product/mcp-elicitation-strategy.md` exists.
- `docs/plans/2026-07-06-mcp-elicitation-implementation-plan.md` exists.
- `docs/product/README.md` links the strategy document.
- `docs/plans/README.md` links this implementation plan.
- Prettier check passes for the changed Markdown files.
