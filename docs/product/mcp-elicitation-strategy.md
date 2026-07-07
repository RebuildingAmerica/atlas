# MCP Elicitation Strategy

- Status: Product strategy reference
- Last updated: 2026-07-06
- Audience: Product, engineering, trust and safety, partnerships, operators, and
  agent-surface maintainers

## Purpose

Atlas already exposes a remote MCP server for source-linked civic discovery.
Assistants can search public actors, inspect sources, resolve issue areas, read
place context, review coverage, open discovery runs, start long-running research
runs, and render MCP Apps widgets. That makes Atlas useful inside the place
where many researchers, journalists, civic technologists, and partner teams are
already asking questions.

MCP elicitation should make that assistant experience more precise, safer, and
more trustworthy. It should not turn Atlas into a conversational form builder.
It should not ask users to repeat information Atlas already knows. It should not
pull sensitive credentials into the MCP client. Its job is narrow and important:
when an Atlas MCP workflow cannot responsibly continue without one more user
decision, Atlas should ask for that decision in the smallest useful shape, let
the user review it, and then continue with the evidence boundary intact.

The product thesis is:

> Atlas uses MCP elicitation as a guided decision layer for civic discovery. It
> asks for the smallest missing decision that makes an assistant answer more
> useful, more source-linked, more budget-aware, or safer to act on.

This strategy document defines how Atlas should adopt elicitation across its MCP
surface, how that adoption maps to Atlas product domains, what belongs in form
mode versus URL mode, which workflows should come first, and which anti-patterns
must be rejected even when they are technically possible.

## Product Context

Atlas has four product domains that a user should feel: Directory, Trust,
Firehose, and Workbench. MCP elicitation matters only insofar as it improves one
of those user experiences.

### Directory

Directory is the public civic discovery surface. A person asks a plain question
such as "who is working on housing in Detroit?" and Atlas helps them find real
people, organizations, initiatives, campaigns, events, sources, and
relationships. MCP makes Directory available in a conversational setting, but
conversation adds ambiguity. Users say "Kansas City" without a state, "labor"
without distinguishing worker centers from unions, or "people" when they may
mean people and organizations.

Directory elicitation should reduce that ambiguity. It should help a user choose
place scope, issue focus, actor types, source confidence, and result depth
before Atlas returns a confident-looking answer. The user-visible outcome is
better first results: fewer irrelevant searches, fewer empty answers caused by a
guessed filter, and less need for the assistant to invent intent.

### Trust

Trust is the proof layer. Atlas publishes claims about real civic actors, so
every result must preserve where the information came from, how fresh it is, how
confident Atlas is, and what remains uncertain. MCP is especially risky because
assistants can compress or summarize evidence into a polished answer.
Elicitation should slow the assistant down at the moments where a missing user
decision could create overclaiming.

Trust elicitation should ask whether the user wants any source-backed leads,
only multiple-source results, recent evidence, public-role people only, or
coverage gaps rather than inferred absence. It should also ask for confirmation
before a tool spends budget, writes workspace state, or moves a result toward a
brief or watch. The user-visible outcome is trust with agency: users decide the
evidence threshold for their task instead of receiving one opaque default.

### Firehose

Firehose is the change-intelligence layer. It should eventually expose
source-backed civic signals through API and MCP, but its product promise is not
"everything happening everywhere." The promise is "what changed, who is
connected to it, what source proves it, and what should someone inspect next?"
Firehose will therefore create new elicitation needs: source cadence, watch
scope, routing intent, review sensitivity, and public/private boundaries.

Firehose elicitation should be conservative. It should clarify which public
sources or coverage targets a workspace wants monitored, what kinds of signals
matter, and whether person-centered signals should be held for review. It must
not create a surveillance-feeling assistant flow. The user-visible outcome is
timely civic awareness with a clear source and a clear reason the signal is in
scope.

### Workbench

Workbench is the paid workflow layer. It lets teams turn source-linked records
into briefs, saved lists, coverage targets, watches, monitoring digests,
exports, integration handoffs, and customer delivery artifacts. MCP already
belongs in Workbench because assistants are useful for research synthesis and
workflow automation. Elicitation is the bridge between "the assistant found
something" and "the user intentionally saved or acted on it."

Workbench elicitation should capture action intent, not private strategy by
default. Good examples are "save these five actors to a working set," "create a
coverage target for this place and issue," "watch this actor for source-backed
changes," or "create a brief from this completed run." The form should keep
visibility, review state, confidence state, and source linkage explicit. The
user-visible outcome is usable civic intelligence: a team can move from search
to action without losing the evidence trail.

## Current MCP Surface

Atlas's current MCP surface is already broad enough to benefit from elicitation.

Read tools:

- `search_entities`
- `get_entity`
- `get_entity_sources`
- `search_sources`
- `get_place_entities`
- `list_discovery_runs`
- `get_discovery_run`
- `get_place_profile`
- `get_place_coverage`
- `get_place_issue_signals`
- `get_related_entities`
- `resolve_issue_areas`

Write or compute tool:

- `start_discovery_run`

Assistant guidance:

- `research_place`
- `find_civic_actors`
- `inspect_source_trail`
- `assess_coverage_gaps`
- `create_research_brief`

Protocol and extension posture:

- Remote Streamable HTTP MCP server at `/mcp`.
- OAuth-protected access with workspace binding and `api.mcp` capability.
- Draft Tasks support for long-running `start_discovery_run`.
- Logging support for structured operation messages.
- MCP Apps widgets for search results, entity cards, and relationship graphs.
- Workspace integration activity that records successful API/MCP usage without
  exposing prompts, payloads, private notes, raw metadata, or session replay.

Elicitation should be introduced as an incremental layer over these surfaces. It
should not require a new product model before it can improve the existing
assistant experience.

## MCP Elicitation Model

The MCP specification defines elicitation as a way for a server to request
additional information from a user through the client during an interaction.
Atlas should treat that as a protocol affordance for explicit user decisions,
not as a generic replacement for tool parameters.

Relevant official MCP references:

- Documentation index: `https://modelcontextprotocol.io/llms.txt`
- Elicitation:
  `https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation.md`
- Lifecycle and capabilities:
  `https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle.md`
- Authorization:
  `https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization.md`
- Security best practices:
  `https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices.md`
- Tasks: `https://modelcontextprotocol.io/extensions/tasks/overview.md`
- MCP Apps: `https://modelcontextprotocol.io/extensions/apps/overview.md`
- Client extension support matrix:
  `https://modelcontextprotocol.io/extensions/client-matrix.md`

### Form Mode

Form mode is for structured, in-band data collection. Atlas should use it for
low-sensitivity decisions that are safe for the MCP client to display and send
back to Atlas.

Appropriate Atlas form-mode data:

- Place disambiguation.
- Issue focus.
- Actor type filters.
- Source type filters.
- Evidence threshold.
- Result depth.
- Research goal.
- Review state.
- Visibility intent.
- Budget confirmation.
- Workspace action confirmation.
- Non-sensitive contact or profile metadata when the user clearly understands
  the MCP client can see it.

Form mode schemas should stay flat and simple. Atlas should prefer strings,
booleans, integers, single-select enums, and small multi-select enum arrays. A
form that needs nested objects probably belongs in the first-party app or a URL
mode flow.

### URL Mode

URL mode is for out-of-band interactions where sensitive information must not
pass through the MCP client. Atlas should use URL mode for secrets, credentials,
payment flows, external OAuth, and flows where the user must interact with an
Atlas-controlled or third-party web page.

Appropriate Atlas URL-mode data and flows:

- Payment setup, checkout, billing portal, or prepaid credits.
- Third-party OAuth for CRM, spreadsheet, cloud storage, calendar, publishing,
  or data warehouse integrations.
- API key or secret setup for an external service.
- Profile claiming or representative authority flows that require identity
  proof, private evidence, credentials, or reviewer-facing material.
- Sensitive connector configuration.

URL mode is not a replacement for MCP authorization. Atlas's MCP server must
continue to identify the user through OAuth and workspace claims. URL-mode
elicitation can let the same authenticated user complete a separate external
authorization or sensitive setup flow, but it must not be used to authorize the
MCP client to Atlas itself.

### Decline And Cancel

Atlas must treat `accept`, `decline`, and `cancel` as distinct product states.

Accept means the user intentionally submitted the requested data or consented to
open the URL.

Decline means the user explicitly rejected the request. Atlas should offer a
less invasive or lower-cost path when possible. For example, if a user declines
to start a discovery run, the assistant can search existing Atlas coverage
instead.

Cancel means the interaction was dismissed or interrupted. Atlas should not
infer intent. It can keep the original conversation alive and let the assistant
ask a normal follow-up, but it should not proceed with state-changing work.

This distinction matters because Atlas's experience is built on trust. A
dismissal is not consent. A declined research run is not a failed tool. A
declined credential flow is not an authorization failure.

## Strategic Principles

### Ask For The Smallest Missing Decision

Elicitation is warranted only when Atlas lacks a decision that materially
changes the answer or action. It is not warranted when the assistant can safely
continue with existing parameters, return a small set of choices in normal
conversation, or use Atlas's existing defaults without creating risk.

Good:

- "Which Kansas City should Atlas search?"
- "Should Atlas include single-source leads?"
- "Start one budgeted research run for Phoenix housing and wage theft?"

Bad:

- Asking the user to fill every optional `search_entities` parameter.
- Asking for issue areas after `resolve_issue_areas` has a clear top match.
- Asking for private team strategy before saving a source-backed working set.

### Prefer Elicitation At Commitment Points

Atlas should use elicitation at moments where a commitment happens:

- A search is ambiguous enough that the wrong result will feel misleading.
- A task will spend budget or compute.
- A workflow will write workspace state.
- A result will be exported or shared.
- A source or signal will be watched over time.
- A sensitive external flow is required.

This lets Atlas stay light during exploration and more explicit during action.

### Preserve Provenance Through Every Elicited Flow

Elicitation must never detach a user decision from evidence. If the assistant
asks whether to save five actors, the form should identify the actors and
evidence threshold, not just "save results." If the assistant asks whether to
create a brief, the form should reference the run and its source-linked outputs.
If the assistant asks whether to watch a profile, the form should name what
source-backed changes the watch is meant to catch.

The rule is: every elicited action that uses Atlas records should preserve
source ids, source URLs, evidence state, confidence, freshness, review state,
and public/private visibility.

### Keep Public Discovery Public

Elicitation must not move Atlas toward privatizing the public graph. A public
user should still be able to browse and search source-backed civic actors
without paying for the facts. Paid MCP access, Workbench actions, metered agent
usage, and URL-mode billing flows can fund scale and workflow, but they must not
turn public civic discovery into an enterprise-only assistant feature.

### Treat Absence As A Coverage Signal

Atlas must never let an elicited answer turn thin coverage into a claim that no
civic work exists. If a user asks for "only multiple-source labor organizers in
Boise" and Atlas finds none, the answer should say that Atlas coverage is thin
under that evidence threshold. Elicitation can make the threshold explicit, but
it cannot convert a filtered absence into truth about the world.

### Avoid Self-Referential User Copy

Atlas user-facing elicitation messages should be plain and direct. They should
not describe internal processes, "pipeline warming," "seeding," or UI behavior.
They should name the decision the user is making and why it matters.

Good:

- "Choose the place to search."
- "Choose the evidence threshold for these results."
- "Confirm this research run before Atlas spends one monthly run."
- "Open Atlas to connect Google Sheets."

Bad:

- "Atlas needs more information to optimize the discovery pipeline."
- "The system is gathering context for the run."
- "This form will populate the next tool call."

### Use URL Mode For Trust Boundaries, Not Convenience

URL mode adds friction. Use it when that friction protects the user: secrets,
payments, external authorization, identity proof, or sensitive setup. Do not use
URL mode merely because it is easier to build a full web form than to design a
small elicitation schema. Conversely, do not force sensitive flows into form
mode to make an assistant demo feel smoother.

### Capability-Gate Everything

Atlas must never assume every client supports elicitation. Clients declare
capabilities during initialization. Atlas should only send form-mode requests
when form mode is supported, only send URL-mode requests when URL mode is
supported, and provide a safe fallback for clients that do not support the mode.

Safe fallback examples:

- Return a normal tool error with the missing required input named plainly.
- Use existing tool behavior when defaults are safe.
- Ask the assistant to present choices in ordinary conversation.
- Direct the user to the first-party Atlas app for flows that require URL mode
  but are not supported by the client.

## Priority Workflows

### 1. Read-Flow Clarification

Read-flow clarification is the first adoption target because it improves the
experience without writing workspace state or adding sensitive flows.

Candidate moments:

- Ambiguous place: "Kansas City", "Portland", "Springfield", "Washington".
- Broad issue: "housing", "labor", "democracy", "climate".
- Actor ambiguity: "people" versus all civic actors.
- Evidence threshold: any leads versus multiple independent sources versus
  recent sources.
- Result shape: quick answer versus source trail versus coverage analysis.
- Source preference: journalism, public records, nonprofit directories,
  organizational websites, reports, podcast pages, campaign pages.

Expected form fields:

- `place`: string or enum when Atlas has candidates.
- `issue_focus`: string or multi-select enum of resolved issue areas.
- `actor_types`: multi-select enum.
- `evidence_threshold`: enum.
- `result_depth`: enum.

User outcome:

- Better results on the first assistant answer.
- Fewer confident answers based on guessed geography or issue scope.
- More source inspection because the assistant can align the result set with the
  user's actual task.

### 2. Discovery Run Preflight

`start_discovery_run` is a budgeted, long-running action. It already depends on
Tasks because it can take minutes. Elicitation should add a preflight before the
run starts when the request is incomplete, ambiguous, expensive, or likely to
produce the wrong run.

Candidate moments:

- Missing state.
- Broad or unresolved issue areas.
- Default research goal unclear.
- Budget is low or the monthly run count matters.
- User asks for a run but existing coverage may already answer the question.

Expected form fields:

- `location_query`: string.
- `state`: two-letter state enum when known.
- `issue_areas`: multi-select enum.
- `research_goal`: enum.
- `actor_types`: multi-select enum where supported.
- `source_emphasis`: multi-select enum where supported.
- `confirm_budgeted_run`: boolean.

User outcome:

- Users understand they are starting real work.
- Monthly discovery budget is spent intentionally.
- Runs have clearer research goals and better review value.
- Decline/cancel can route users back to existing data instead of treating the
  workflow as failed.

### 3. Adaptive Prompts

Current Atlas MCP prompts are static. They help clients expose guided research
workflows, but missing arguments must be supplied up front or handled by the
assistant. Elicitation lets prompts become adaptive without making them
write-capable.

Prompt patterns:

- `research_place`: ask for issue focus when the user wants a narrower civic
  landscape.
- `find_civic_actors`: ask for place and evidence threshold when the query is
  too broad.
- `inspect_source_trail`: ask the user to choose from candidate matches.
- `assess_coverage_gaps`: ask whether to assess all issues or a focused set.
- `create_research_brief`: ask the user to choose a completed run when "that
  run" or "latest run" is ambiguous.

User outcome:

- Prompts become better starting points for non-expert users.
- The assistant spends less time recovering from incomplete prompt arguments.
- Source and coverage expectations are established before synthesis.

### 4. Workbench Write Handoffs

Workbench write tools should come after the read and discovery-run patterns are
proven. Elicitation is valuable here because writes are exactly where Atlas
should capture intent.

Candidate actions:

- Save selected actors to a working set. Implemented first through
  `save_entities_to_list` for existing saved lists.
- Create a brief from a discovery run.
- Create a coverage target. Implemented first through `create_coverage_target`
  for private workspace targets with linked evidence.
- Watch an actor, source, issue, place, or coverage target. Implemented first
  through `watch_workspace_resource` for entries and coverage targets, with
  typed notification preferences.
- Export a brief or coverage report.
- Sync reviewed Scout artifacts into the active workspace.

Expected form fields:

- `workspace_action`: enum.
- `resource_ids`: multi-select enum when the candidate set is small.
- `visibility`: enum.
- `review_state`: enum.
- `confidence_state`: enum.
- `include_private_notes`: boolean only when the flow is clearly workspace
  private and authorized.
- `confirm_action`: boolean.

User outcome:

- Assistant workflows become usable without turning public discovery into a
  generic enterprise dashboard.
- Private workspace state stays private.
- Briefs, coverage targets, watches, and exports keep source evidence attached.

### 5. URL-Mode Sensitive Flows

URL mode should be adopted after Atlas has a clean form-mode pattern and a clear
URL-mode state model. It is essential for secure integrations, but it is not the
fastest path to improving the core civic discovery experience.

Candidate flows:

- Billing portal, checkout, prepaid credits, or over-limit purchase flow.
- Third-party OAuth for Google Sheets, Airtable, Notion, CRM, cloud storage,
  calendar, or publishing systems.
- External API key setup.
- Profile claiming and stewardship proof.
- Sensitive connector configuration.

URL requirements:

- HTTPS in non-development environments.
- No secrets, credentials, or sensitive personal data in the URL.
- No pre-authenticated URLs that would let a malicious client impersonate the
  user.
- The URL should point first to an Atlas-controlled connect page when identity
  binding is required.
- The connect page must verify that the browser session user matches the MCP
  user who initiated the elicitation.
- The server should send completion notifications when supported, but clients
  must still have manual retry/cancel paths.

User outcome:

- Sensitive setup happens on trusted web surfaces.
- The MCP client and LLM never see third-party credentials.
- External integrations become possible without weakening Atlas's trust model.

## Form Schema Policy

Atlas form-mode schemas should be product-designed, not auto-generated from tool
schemas. Tool schemas describe what the server can accept. Elicitation schemas
describe what a user can reasonably decide in a moment.

Schema rules:

- Use flat objects only.
- Prefer enums over free text when Atlas has known choices.
- Use clear titles and concise descriptions.
- Provide defaults only when the default is safe and user-comprehensible.
- Keep required fields to the minimum needed to continue.
- Avoid URLs in form descriptions or fields except when the field itself is a
  non-sensitive URI input.
- Do not include internal IDs as the only user-visible option labels; pair ids
  with names or titles.
- Do not request secrets, credentials, access tokens, API keys, payment
  credentials, or private identity documents.
- Validate returned data server-side even if the client validates the schema.

Recommended common enums:

- `evidence_threshold`: `any_source_backed_leads`, `recent_sources_preferred`,
  `multiple_independent_sources`, `ready_for_high_stakes_review`
- `result_depth`: `quick_list`, `source_linked_summary`, `coverage_analysis`,
  `brief_ready`
- `actor_types`: `person`, `organization`, `initiative`, `campaign`, `event`
- `research_goal`: `landscape_scan`, `source_refresh`, `gap_analysis`,
  `briefing_research`, `watch_setup`
- `visibility`: `workspace_private`, `public_safe_candidate`,
  `needs_review_before_public`

These names are product examples, not final protocol constants. Engineering
should define stable constants during implementation and keep them aligned with
existing Atlas schemas.

## Messaging Policy

Elicitation copy should be short, plain, and tied to user agency.

Message template:

> [Decision verb] [thing] so Atlas can [user-visible outcome].

Examples:

- "Choose the place to search so Atlas returns the right civic actors."
- "Choose an evidence threshold so the answer matches how you plan to use it."
- "Confirm this research run before Atlas spends one monthly run."
- "Choose the completed run for the brief."
- "Open Atlas to connect Google Sheets."

Avoid:

- Implementation details.
- Pipeline explanations.
- Claims that Atlas is "still gathering" or "warming up."
- Pressure language around paid plans or budget.
- Overly broad privacy assurances.
- Assistant-centric language such as "I need this to call the tool."

## Security And Trust Boundaries

Elicitation creates a new interaction surface, so Atlas must treat it as part of
the trust system.

### Identity Binding

Atlas must bind elicitation state to the verified MCP user and workspace, not to
client-provided claims or session ids alone. For URL mode, Atlas must verify
that the user who opens the URL is the same user who initiated the MCP
elicitation. This is especially important for OAuth and credential flows, where
a malicious user could otherwise trick another user into completing
authorization that becomes bound to the wrong account.

### Workspace Boundary

Workspace context is private unless a user deliberately publishes a public-safe
record. Elicitation must not blur that boundary. A form can ask whether to save
actors to a workspace list, but it should not imply that the saved list proves
public truth. A form can ask whether a run result should become a brief, but the
brief remains a workspace artifact unless explicitly exported or published.

### Sensitive Data Boundary

Secrets never belong in form mode. If a flow involves passwords, API keys,
access tokens, payment credentials, private identity documents, or third-party
authorization codes, use URL mode or the first-party app.

### Rate Limiting

Clients are expected to rate-limit elicitation requests, but Atlas should not
depend on clients alone. Server-side controls should prevent loops, repeated
prompting, and abusive flows. A tool should not elicit the same missing field
indefinitely. If a user declines or cancels, Atlas should respect that state and
offer an alternative path.

### Logging

Atlas should log elicitation lifecycle metadata for observability and support:

- MCP surface.
- Tool or prompt.
- Elicitation mode.
- Accepted, declined, canceled, expired, or completed state.
- Workspace id.
- Non-sensitive field names requested.
- Latency and retry count.

Atlas should not log submitted form content by default if the content could
contain user-provided text, private notes, or contact details. Atlas should not
log URL query strings for sensitive flows.

## Metrics

Elicitation success should be measured by experience quality, not by the count
of forms shown.

Product metrics:

- Search clarification acceptance rate.
- Reduction in empty or irrelevant MCP search results.
- Follow-up source inspection rate after clarified searches.
- Discovery-run preflight acceptance, decline, and cancel rates.
- Discovery-run completion-to-brief or completion-to-coverage-target rate.
- Budget error reduction after preflight launch.
- Prompt completion rate for guided workflows.
- Workbench action conversion from MCP-assisted sessions.
- URL-mode completion rate for sensitive setup flows.

Trust and safety metrics:

- Form-mode secret-block events.
- URL-mode identity mismatch events.
- Decline/cancel retry loops blocked.
- Workspace/private boundary violations prevented.
- Elicited actions that preserve source ids and evidence fields.
- Support tickets involving MCP confusion or unexpected actions.

Operational metrics:

- Elicitation request latency.
- Client capability distribution.
- Unsupported-client fallback rate.
- Completion notification delivery rate for URL mode.
- Tool retry success after URL-mode completion.

The most important qualitative metric is whether a user can explain why Atlas
asked, what choice they made, and where the evidence went afterward.

## Rollout Strategy

Atlas should roll out elicitation in phases.

Phase 0: capability audit and protocol spike.

- Confirm current Python MCP SDK support.
- Confirm client support for form mode, URL mode, Tasks, logging, and Apps.
- Build a minimal local prototype or compatibility shim only if the SDK does not
  expose the needed server request path.
- Decide fallback behavior for unsupported clients.

Phase 1: read-flow clarification.

- Add form-mode elicitation to ambiguous read workflows.
- Keep all actions read-only.
- Measure search quality and fallback behavior.

Phase 2: discovery-run preflight.

- Add budgeted-run confirmation and missing-field collection.
- Preserve current Tasks behavior.
- Treat decline/cancel as normal outcomes.

Phase 3: adaptive prompts.

- Let prompts request missing arguments or resolve ambiguous matches.
- Keep prompts read-only unless a later Workbench write phase is approved.

Phase 4: Workbench write handoffs.

- Add elicitation to save, brief, coverage, watch, export, and sync actions as
  those MCP write tools become available.
- Preserve visibility and source evidence.

Phase 5: URL-mode sensitive flows.

- Add URL mode for billing, third-party OAuth, secret setup, identity proof, and
  profile claiming.
- Implement identity binding and completion notifications.

Phase 6: public docs and operational maturity.

- Add a concise public docs page once behavior is real.
- Add admin-facing integration activity details that remain privacy-safe.
- Add runbooks for support, abuse, and client-specific issues.

## Anti-Patterns

### Prompting Because The Server Can

Do not elicit merely because the protocol supports it. Every request interrupts
the user. If the assistant can answer safely without elicitation, it should.

### Converting Every Tool Parameter Into A Form

Tool schemas are not product flows. A full `search_entities` form would be a
worse experience than a short clarifying question.

### Asking For Sensitive Data In Form Mode

This is forbidden. It also undermines user trust. Use URL mode.

### Hiding Payment Or Budget Friction

Atlas should not surprise users with quota consumption. Budgeted or paid actions
should be confirmed plainly.

### Using Elicitation To Patch Weak Product Copy

If the assistant or docs cannot explain a workflow clearly, do not solve that
with extra forms. Fix the product language and workflow.

### Treating Decline As Failure

Decline is an explicit user choice. Atlas should handle it with alternatives,
not error panic.

### Treating Workspace State As Public Evidence

A saved list, brief, or watch does not prove a public claim. Elicitation must
not collapse workflow decisions into public truth.

### Shipping URL Mode Without Identity Binding

URL-mode flows are vulnerable if the user who completes the browser flow is not
verified as the same user who initiated the MCP request. Atlas must not ship
sensitive URL mode without this protection.

## Decisions

1. Atlas should adopt elicitation first for MCP read-flow clarification and
   discovery-run preflight.
2. Atlas should delay URL-mode sensitive flows until form-mode patterns,
   capability gating, and identity-bound elicitation state are understood.
3. Atlas should design elicitation schemas as product contracts, not generated
   copies of tool schemas.
4. Atlas should keep public civic discovery and provenance visible in every MCP
   elicitation flow.
5. Atlas should update public Mintlify docs only after a workflow exists or when
   users need setup/troubleshooting guidance.

## Open Implementation Questions

These are intentionally left for the implementation plan and engineering spike,
not for the product strategy:

- Whether the installed Python MCP SDK already exposes server-to-client
  elicitation requests, or whether Atlas needs a small low-level JSON-RPC
  wrapper similar to the Tasks shim.
- How to store short-lived elicitation state for URL mode in stateless Cloud Run
  deployments.
- Whether read-flow elicitation should live in per-tool wrappers, shared MCP
  utility functions, or a higher-level orchestration layer.
- How much capability data Atlas can reliably observe from popular clients
  during initialization.
- Which clients should be included in the first support matrix.
- Whether Workbench write tools should be implemented before or after URL-mode
  billing and integration flows.
