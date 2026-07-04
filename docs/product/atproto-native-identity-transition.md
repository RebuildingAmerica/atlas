# ATProto-Native Identity Transition

Status: Draft
Date: 2026-07-04
Owner: Rebuilding America Project

## Purpose

Atlas should move toward decentralized identity without losing the practical
auth, workspace, SSO, and governance machinery needed to serve real public
users and institutions. This document describes the vision, transition
architecture, refactor shape, and final state for making ATProto identity a
native part of Atlas.

This is not a plan to add a "Sign in with Bluesky" button and call it done.
The goal is deeper: Atlas should treat durable decentralized identity as a
first-class civic trust primitive. A person, organization, source submission,
profile claim, public field note, and directory contribution should be able to
carry a stable identity trail that survives handle changes, account migration,
and reuse outside the first-party Atlas app.

## Experience Principle

The user-facing experience stays simple:

- Public users see normal language: "verified linked handle," "claim with
  ATProto," "submitted by," and "source-backed."
- Profile subjects can prove who they are without navigating enterprise
  account setup.
- Civic actors can carry a public identity across Atlas and the federated web.
- Institutional teams can still use SSO, workspace roles, API keys, and
  managed access controls.
- Nobody has to understand DIDs, PDSes, Lexicons, AT URIs, or CIDs to find
  useful civic information.

The architecture can be sophisticated. The interface cannot feel that way.

## Protocol Grounding

ATProto gives Atlas four primitives that map cleanly to Atlas's trust goals:

- **DID:** the durable account identifier. Handles can change; the DID is the
  stable identity key Atlas should store.
- **Handle:** the human-readable display name. Atlas should show it, but never
  treat it as the canonical identity.
- **PDS:** the user's data host. Atlas should expect users to live on different
  PDSes and to migrate over time.
- **Lexicon records:** interoperable typed records. Atlas can define civic
  contribution records that other tools can read and write.

Relevant protocol references:

- [AT Protocol overview](https://atproto.com/guides/overview)
- [AT Protocol DID spec](https://atproto.com/specs/did)
- [ATProto OAuth guide](https://atproto.com/guides/oauth)
- [ATProto Lexicons guide](https://atproto.com/guides/lexicon)
- [ATProto sync specification](https://atproto.com/specs/sync)

## Current State

Atlas currently has three identity layers that work, but are not yet
decentralized:

1. **App identity and sessions**
   - Better Auth owns sessions, magic links, passkeys, email verification, and
     browser cookies.
   - Better Auth also provides organization membership, enterprise SSO, API
     keys, JWTs, and Atlas-as-OAuth-provider behavior for MCP/API clients.
   - Atlas session payloads are centered on Better Auth user id and email.

2. **API actor identity**
   - FastAPI accepts authenticated actors through trusted app-server headers,
     API keys, or Better Auth-issued OAuth JWTs.
   - API authorization is workspace/capability aware.
   - API actor identity is currently derived from the Atlas user id, email,
     organization id, and permissions.

3. **Profile subject identity**
   - Profile claims bind to Atlas user ids and email/manual proof.
   - Claimed profiles can expose subject-managed fields.
   - The claim system is already the right place to add public identity proof,
     but it does not yet have a general identity-proof model.

The missing layer is an Atlas identity graph: a way to say that one Atlas user
or one public profile can be connected to one or more identity proofs, including
an ATProto DID.

## Target State

The final state is DID-native, not DID-only.

Atlas should understand these identity types:

- **Atlas user id:** internal account/session anchor.
- **ATProto DID:** preferred durable public identity for civic actions.
- **ATProto handle:** display identity that can change.
- **Email identity:** recovery, notification, and workspace invitation channel.
- **Passkey identity:** device-bound login assurance.
- **SSO identity:** institution-managed workspace access and lifecycle.
- **API key identity:** machine/service access scoped to a workspace.
- **Profile steward identity:** approved subject or delegate control over
  subject-managed profile fields.

These are not interchangeable. A person can be:

- signed into Atlas with SSO,
- a member of an enterprise workspace,
- linked to a personal ATProto DID,
- delegated to manage an organization profile,
- and authorized to publish or submit public civic records.

The product should model that complexity under the hood while presenting a
clear, humane interface.

## Final-State Architecture

```text
Public user or workspace member
  |
  | signs in with ATProto, email/passkey, or enterprise SSO
  v
Atlas app session
  |
  | resolves identities and workspace context
  v
Atlas identity graph
  |               |
  |               +-- SSO/workspace identity for enterprise access
  |               +-- Email/passkey identity for recovery and login
  |               +-- API key identity for integrations
  |
  +-- ATProto DID identity for public civic provenance
          |
          +-- profile claims
          +-- source submissions
          +-- field notes
          +-- directory contributions
          +-- follows and public stewardship
```

```text
ATProto PDS / repo
  |
  | records, repo events, handle/DID resolution
  v
Atlas federation ingestion
  |
  | validates AT URI, CID, DID, NSID, record shape
  v
Atlas review layer
  |
  | accepts, rejects, suppresses, disputes, or requests more context
  v
Atlas civic AppView
  |
  | presents source-backed public profiles, directories, search, and maps
  v
Atlas public experience
```

Atlas should begin as an ATProto OAuth client, civic AppView, indexer, and
review layer. Managed PDS hosting is optional later, not a prerequisite for
identity, claiming, discovery, SSO, source submission, or public use.

## Transition Step 1: Identity Graph Foundation

### System Shape

```text
Better Auth user
  |
  v
Atlas identity graph
  |
  +-- email identity
  +-- passkey identity
  +-- SSO identity
  +-- future ATProto identity
```

### Product Outcome

Atlas stops treating email as the canonical identity and starts treating it as
one linked identity among several. This prepares the product for decentralized
identity while preserving all current auth paths.

### Refactor Needed

- Add an identity domain in the app/auth layer.
- Introduce an `atlas_identities` model or equivalent that can represent
  provider, provider subject, verification state, display label, and primary
  status.
- Update normalized session contracts to support `identities`,
  `primaryIdentity`, and contact/recovery state.
- Keep existing Better Auth session, SSO, org, API-key, and OAuth-provider
  behavior intact.
- Add proof records for profile claims instead of treating claim evidence as an
  opaque string.

### Compatibility Rules

- Existing users keep their Better Auth user id.
- Existing email and SSO sign-in continues to work.
- Existing profile claims migrate to `email_domain` or `manual` proof records.
- Public profiles should not change visually until an identity proof is
  approved.

## Transition Step 2: ATProto Linked Identity

### System Shape

```text
Signed-in Atlas user
  |
  | Connect ATProto
  v
ATProto OAuth BFF flow
  |
  | resolve handle -> DID -> PDS
  | verify callback subject
  v
Linked ATProto identity
  |
  +-- DID
  +-- current handle
  +-- PDS URL
  +-- verification state
```

### Product Outcome

A public user or profile subject can connect a decentralized identity to an
existing Atlas account. Profile claims can use ATProto proof, but ATProto posts
do not become Atlas facts.

### Refactor Needed

- Add ATProto OAuth BFF routes in the app server.
- Publish ATProto OAuth client metadata under the Atlas public origin.
- Resolve handles to DIDs and DIDs to PDS service endpoints.
- Store OAuth state and tokens only in the app/auth layer.
- Store public/provenance identity fields in the Atlas identity graph.
- Add handle re-resolution and changed-handle states.
- Add claim proof type `atproto`.

### Auth Boundary

This is separate from Atlas's existing OAuth-provider surface. Atlas currently
acts as an OAuth authorization server for MCP/API clients. ATProto support
makes Atlas an OAuth client of a user's PDS. Those flows should not share route
handlers, token storage, or mental models.

## Transition Step 3: ATProto-First Public Sign-In

### System Shape

```text
Visitor chooses Continue with ATProto
  |
  v
ATProto OAuth BFF flow
  |
  v
Find or create Atlas user for DID
  |
  v
Better Auth session
  |
  v
Atlas public actions: follow, claim, submit source, steward profile
```

### Product Outcome

A person can use Atlas with decentralized identity first. Email remains
optional for recovery, notifications, and workspace invitations. Enterprise SSO
remains available for workspace access.

### Refactor Needed

- Add a public sign-in path that starts from handle entry.
- Link verified DID to an existing user when safe.
- Create a new Atlas user when the DID has no existing user.
- Avoid implicit account takeover by requiring explicit linking when an email
  or SSO user already exists.
- Update account setup so email is recommended but not mandatory for public
  actions that do not require email.
- Keep passkey enrollment available as a local assurance/recovery layer.

### UX Rules

- Use simple labels like "Continue with ATProto" and "Connect your handle."
- Explain handle changes only when relevant.
- Do not force DID terminology into the first-run experience.
- Make email collection contextual: notifications, recovery, invitations, and
  workspace membership.

## Transition Step 4: Enterprise Identity Bridge

### System Shape

```text
Workspace member
  |
  | signs in through enterprise SSO
  v
Workspace session and role
  |
  +-- organization membership
  +-- entitlements and API keys
  +-- audit and compliance requirements
  |
  +-- optional linked ATProto DID for public civic provenance
```

### Product Outcome

Atlas can support institutions without abandoning decentralized identity. SSO
answers "is this person allowed into this workspace?" ATProto answers "what
durable public identity is attached to this civic action?"

### Refactor Needed

- Keep Better Auth organization, SSO, role, invitation, and API-key flows as
  the workspace authority.
- Model SSO identities separately from ATProto identities.
- Allow workspace users to link ATProto DIDs, but do not require it for
  workspace access.
- Allow organization profile claims to be proven through domain, SSO-admin
  approval, manual review, or ATProto organization handle/DID proof.
- Add workspace policy settings later for whether public artifacts can display
  member-linked DIDs.

### Enterprise Rules

- SSO is not a replacement for public profile stewardship.
- ATProto is not a replacement for workspace authorization.
- Workspace private notes, customer artifacts, and admin metadata never publish
  to ATProto.
- Enterprise exports preserve identity provenance but do not expose private
  identity metadata unless explicitly included by an authorized user.

## Transition Step 5: Federated Civic Records

### System Shape

```text
User-owned PDS record
  |
  | org.rebuildingamerica.atlas.sourceSubmission
  v
Atlas ingestion
  |
  | validates DID, AT URI, CID, NSID, record shape
  v
Review queue
  |
  | accept / reject / dispute / suppress
  v
Atlas evidence and public profile surfaces
```

### Product Outcome

Civic contributions become portable, source-linked records on the federated
web. Atlas indexes and reviews them, but users do not need Atlas to be the sole
holder of their civic identity or contribution history.

### Refactor Needed

- Define initial Lexicons only after local source-submission semantics are
  stable.
- Add federated record ingestion for source submissions, field notes, directory
  contributions, and profile claim intents.
- Store AT URI, CID, author DID, handle at observation, collection NSID, record
  key, indexed timestamp, and review state.
- Add review workflows that convert accepted records into source candidates,
  evidence, field notes, or directory contributions.
- Add outbound publishing only after inbound review and identity behavior are
  stable.

### Trust Rules

- ATProto records are contributions or source candidates, not facts.
- Follows, likes, reposts, quotes, and social proximity do not establish civic
  alignment by themselves.
- Deleted, moved, or unavailable records remain reviewable through stored
  provenance metadata.
- Atlas review state controls public presentation.

## Transition Step 6: Optional Managed PDS

### System Shape

```text
Civic actor without a PDS
  |
  | optional managed account
  v
Atlas-adjacent managed PDS
  |
  | portability, export, recovery, abuse handling
  v
Same Atlas AppView and review layer
```

### Product Outcome

Atlas can eventually help civic actors who want decentralized identity but do
not want to choose or operate a PDS. This is a later service capability, not
the core identity transition.

### Requirements Before This Ships

- Account portability guarantees.
- Export and deletion paths.
- Account recovery policy.
- Moderation and abuse process.
- Backup and disaster recovery.
- Clear separation from Atlas workspace accounts.
- Clear exit path to a user-chosen PDS.

## Data Model Direction

### Identity

```text
atlas_identities
- id
- user_id
- provider
- provider_subject
- display_label
- verification_state
- primary_for_user
- created_at
- updated_at
```

### ATProto Identity

```text
atproto_identities
- identity_id
- did
- current_handle
- pds_url
- handle_verified_at
- did_resolved_at
- last_resolution_error
- profile_entry_id
```

### Claim Proof

```text
profile_claim_proofs
- id
- claim_id
- proof_type
- identity_id
- proof_status
- proof_summary
- reviewed_by_user_id
- reviewed_at
- created_at
```

### Federated Record

```text
federated_records
- id
- source_network
- at_uri
- cid
- author_did
- author_handle_at_observation
- collection_nsid
- record_key
- record_json
- indexed_at
- review_state
- linked_source_id
- linked_evidence_id
```

These names are directional, not final schema. The implementation plan should
align them with Atlas's existing raw-SQL schema and OpenAPI conventions.

## API And Interface Direction

### App Server

- `GET /api/atproto/oauth/client-metadata.json`
- `POST /api/atproto/oauth/start`
- `GET /api/atproto/oauth/callback`
- `POST /api/atproto/identity/link`
- `POST /api/atproto/identity/refresh`
- `DELETE /api/atproto/identity/:id`

### FastAPI Catalog

- `GET /api/identities/me`
- `GET /api/profiles/{slug}/identity`
- `POST /api/profiles/{slug}/claims/atproto`
- `GET /api/federation/records/{id}`
- `POST /api/federation/source-candidates`

### Session Contract

Atlas session payloads should eventually expose:

- Internal user id.
- Display identity.
- Verified identities.
- Primary public identity.
- Email/contact state.
- Workspace membership and capabilities.
- Whether the current session came from SSO, ATProto, magic link, passkey, API
  key, or local mode.

## Final-State User Journeys

### Public profile claim

1. User opens a profile.
2. User chooses claim.
3. User signs in with ATProto.
4. Atlas resolves DID and links it to the claim.
5. Atlas checks whether existing public sources support the connection.
6. Low-risk claims can verify; ambiguous claims go to review.
7. Public profile shows verified linked handle only after approval.

### Enterprise workspace access

1. Member opens workspace.
2. Member signs in through enterprise SSO.
3. Atlas resolves workspace role and capabilities.
4. Member optionally links ATProto DID for public actions.
5. Workspace private work remains private.

### Source submission

1. Civic actor submits a source from Atlas or an ATProto record.
2. Atlas stores source candidate provenance.
3. Reviewer accepts, rejects, disputes, or asks for more context.
4. Accepted source becomes evidence with identity provenance attached.

### Organization profile stewardship

1. Organization admin signs in through SSO or email-domain proof.
2. Organization links an ATProto org handle or DID when available.
3. Atlas verifies representation through domain, SSO-admin approval, ATProto,
   manual review, or a combination.
4. Delegates manage subject-provided fields.

## Final State

Atlas is:

- a public civic discovery product,
- a source-linked profile and evidence system,
- a DID-native identity-aware application,
- an ATProto OAuth client,
- a civic AppView/indexer,
- a review and trust layer,
- an enterprise-capable workspace product,
- and optionally, later, a managed PDS provider.

Atlas is not:

- a generic enterprise identity provider,
- a private data broker,
- a social graph inference engine,
- a PDS-first hosting company,
- or a tool that turns federated posts into facts without review.

The destination is not decentralization as architecture theater. The destination
is a better civic experience: people can find public civic work, trust the
identity behind contributions, claim and steward their presence, and carry that
identity across the federated web.

## Open Product Decisions

- Which public actions require ATProto identity versus any signed-in Atlas
  identity?
- When can ATProto proof auto-verify a profile claim?
- What enterprise policy controls should exist for showing member-linked DIDs on
  public artifacts?
- Which Lexicon should ship first: source submission, field note, profile claim,
  or directory contribution?
- What guarantees must exist before Atlas offers managed PDS hosting?

## Implementation Sequencing

1. Identity graph foundation.
2. ATProto linked identity.
3. ATProto proof for profile claiming.
4. Session payload refactor.
5. ATProto-first public sign-in.
6. Enterprise identity bridge.
7. Federated source submissions.
8. Field notes and outbound publishing.
9. Atlas Lexicons.
10. Optional managed PDS evaluation.

Each step must preserve public discovery, profile trust, correction paths, and
workspace SSO behavior before advancing.
