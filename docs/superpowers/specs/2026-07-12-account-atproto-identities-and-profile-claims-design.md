# Account-First ATProto Identities and Profile Claims

**Status:** Implemented

**Date:** 2026-07-12

**Owner:** Rebuilding America Project

## Outcome

Atlas users can connect ATProto identities from Bluesky or any compatible PDS in
Account settings, then use those identities to claim or manage person and
organization profiles. The DID is the durable identity. OAuth proves that an
Atlas user currently controls it. A profile claim or verified steward action
separately proves that the DID represents a public profile.

This gives people a clear account-level identity experience now and leaves
Atlas-managed ATProto accounts as a later provider that can use the same model.
It does not make profile claiming the place where identities are created or
owned.

## Product Decisions

- External linking ships before Atlas-managed accounts.
- An ATProto identity exists independently from Atlas users, public profiles,
  and workspaces.
- Atlas records explicit, verified relationships instead of assigning the DID to
  one user record.
- Profile stewardship is separate from workspace membership. A verified claim
  grants profile stewardship; it does not create a workspace or grant workspace
  access.
- Workspace administration of ATProto identities is out of scope until the
  account, user, identity, and workspace boundaries are designed together.
- A user may control multiple ATProto identities. One DID may have only one
  active controlling Atlas user at a time. A second user receives an explicit
  account-conflict error rather than a duplicate link.
- Person claims remain reviewable claims. OAuth control alone does not prove
  that a civic profile describes the same person.
- Organization claims keep the existing trust threshold: a handle matching an
  organization domain may verify the low-risk path; a shared-service handle such
  as `*.bsky.social` also needs domain, verified steward, workspace-role, or
  reviewer proof.

## Identity Model

The existing `atproto_identities.user_id` ownership model is replaced by three
focused relations:

1. `atproto_identities` stores one row per DID, with current handle, PDS URL,
   resolution status, verification timestamps, and the most recent resolution
   error.
2. `user_atproto_controls` records that a Better Auth user proved current OAuth
   control of a DID. It carries active, disconnected, and conflict states plus
   verification and disconnection dates.
3. `profile_atproto_links` records that a verified profile is represented by a
   DID. It carries the supporting claim/proof, verified,
   reverification-required, and removed states, and audit dates.

Existing verified profile claims remain the user-to-profile stewardship
relationship. The manage authorization path continues to require the verified
claimant. This release does not introduce a generic polymorphic link table or a
parallel workspace identity table.

The migration is automated and trust-preserving:

- Existing single-user DID links become active control records.
- If the same DID is linked to multiple users, the identity is preserved but
  every competing control is marked `conflict`; no user receives active control
  until OAuth is completed again.
- Existing entry-level ATProto fields become profile links. Links that cannot be
  re-resolved are retained as `reverification_required`, not displayed as
  currently verified.
- Runtime reads switch completely to the new relations. The old user-owned table
  shape and entry ATProto columns are removed rather than maintained as fallback
  sources.

## Account Experience

`/account` gains an **Identity** section between Profile and Security. It is the
primary home for ATProto connection and lifecycle actions.

The empty state says that an ATProto account can be used for profile
verification and public civic contributions, followed by one **Connect ATProto
account** action. Connecting asks for a handle and uses the existing generic
ATProto OAuth discovery flow, so Bluesky and other compatible PDS hosts work
without provider-specific buttons.

Each connected identity is shown as a compact row with:

- current handle;
- connected or needs-attention state;
- connection date and last verification date;
- profiles currently using the identity;
- **Check connection**, **Reconnect**, and **Disconnect** actions when
  applicable.

DID and PDS details stay under a **Technical details** disclosure. The primary
surface never asks the user to understand protocol vocabulary.

Disconnecting removes the user-control relationship and stops the identity from
being selected for new actions. It does not silently remove an approved identity
from a public profile. The confirmation lists affected profiles and explains
that a verified profile steward must remove or replace those public links.
Reconnecting the same DID restores control after successful OAuth.

OAuth return state accepts only three first-party destinations: Account
Identity, a claim route, or a verified-profile manage route. Successful
callbacks persist the identity before redirecting and return only an opaque
identity id and success status. Recoverable errors return to the same surface.
Claim and manage drafts survive the round trip in same-tab session storage and
are cleared after submission or explicit cancellation.

## Claim and Stewardship Experience

The claim form uses one shared **ATProto identity** selector for people and
organizations. It lists identities already connected in Account settings and
offers a secondary **Connect another account** action that runs the same
account-level flow and returns with the new identity selected.

For a person profile, the step is titled **Verify this is you**. ATProto control
is one evidence path, alongside the existing public evidence and review path.
Submission includes the selected identity id, but the claim remains pending
unless the claim policy explicitly supports low-risk verification.

For an organization profile, the step remains **Show you represent this
organization**. The user may select an official ATProto identity, prove the
organization domain, or use an eligible workspace role. The existing
additional-proof rule for shared-service handles remains visible before
submission.

When a claim is approved, Atlas creates or updates the profile-to-DID link. The
public profile shows the verified handle only while the link and current
DID/handle resolution remain healthy. A handle change updates display metadata
without changing the DID relationship. Failed resolution changes the public
state to needs attention instead of continuing to present stale confidence.

Verified stewards can add, replace, or remove the public ATProto identity from
the existing profile management page. They select from identities they currently
control. These actions revalidate the DID and handle and write an auditable
profile link; they do not edit the external ATProto account.

Atlas must not route every handle to Bluesky. Public profiles show the verified
handle as identity text. An outbound profile link appears only when Atlas has an
explicitly verified public URL for that identity.

## Interfaces and Data Flow

The FastAPI identity surface provides authenticated operations to list the
current user's controls, refresh an identity, disconnect it, and complete the
app-server OAuth link. Profile endpoints attach or remove a controlled identity
for a verified steward. Claim requests continue to accept `atproto_identity_id`,
but validation now checks an active control relation and resolves the global
identity record.

The app server remains the ATProto OAuth client and owns temporary OAuth state.
It does not retain long-lived ATProto tokens in this release. The catalog API
owns durable DID metadata, control relationships, profile links, and claim
proofs. Periodic revalidation reads the new profile links and updates their
state atomically.

OpenAPI and the generated app client expose the identity list, refresh,
disconnect, profile attach, and profile detach contracts. Account and claim
components consume those generated contracts through TanStack Query, with one
identity query key invalidated after every lifecycle action.

## Failure and Trust States

- Invalid or unresolved handle: stay on the initiating surface and identify the
  handle that failed.
- OAuth identity differs from the requested handle: reject the connection and
  preserve the draft.
- DID already controlled by another Atlas user: do not reveal that user's
  information; direct the current user to account recovery or support.
- Handle changed: update the handle after bidirectional DID/handle verification
  and retain the link.
- PDS unavailable or DID mismatch: mark the control and affected profile links
  needs attention.
- Identity disconnected during a draft: block submission and ask the user to
  reconnect or choose another identity.
- Profile already represented by another DID: require explicit replacement by a
  verified steward or claim review; never overwrite it during claim submission.

Loading is silent or uses a compact progress indicator. Empty states state the
fact and offer the next action. Errors describe what failed without narrating
internal discovery or verification machinery.

## Acceptance Criteria

- A signed-in user can connect, list, refresh, reconnect, and disconnect an
  external ATProto identity from Account settings.
- Bluesky and non-Bluesky compatible handles use the same OAuth flow.
- A person claimant can select a connected identity and submit it as claim
  proof.
- An organization claimant can select a connected identity and satisfy the
  existing additional-proof rule when required.
- OAuth round trips preserve claim and manage drafts.
- Approved claims and verified-steward actions create auditable profile-to-DID
  links.
- Handle changes preserve DID-based profile linkage; failed resolution does not
  remain confidently displayed.
- Organization identity links survive removal of the original user's control
  relationship.
- No account action grants workspace membership, and no workspace action
  silently grants public profile stewardship.
- Existing ATProto links migrate without silent identity conflicts or dual-read
  fallbacks.
- Account, claim, manage, public-profile, API, migration, and OAuth acceptance
  tests cover success, conflict, stale, disconnect, and recovery paths at the
  repository's coverage gates.

## Deferred Work

- Atlas-managed PDS accounts and Atlas-issued handles.
- ATProto-first Atlas sign-in and account creation.
- Workspace-owned or workspace-administered identity controls.
- Multiple simultaneous profile stewards and delegated identity administration.
- Publishing Atlas records to a user's PDS, feeds, and custom Lexicons.
- Account merging and automated transfer of an active DID between Atlas users.

The product and roadmap documents will be updated with this external-first
sequence. Relevant ATProto planning language currently stranded in
`chore/atproto-org-identity-plans` will be incorporated intentionally without
modifying or deleting that worktree's uncommitted changes.
