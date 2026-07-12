# Profile Claiming And Stewardship PRD

Status: Draft Date: 2026-07-03 Owner: Rebuilding America Project

## User Outcome

A person or organization represented in Atlas can claim a profile, prove a
connection to it, improve how they are represented, request corrections, and
manage safe public contact preferences.

## Problem

Atlas can discover public information, but subjects need agency over
representation. Claiming must be easy enough for legitimate subjects and careful
enough to prevent impersonation, capture, harassment, or whitewashing of
source-backed public facts.

## Users

- Person named in an Atlas profile.
- Organization representative.
- Initiative or campaign representative.
- Atlas reviewer resolving claim requests.
- Public user checking whether a profile is subject-stewarded.

## Trust State Contract

Claiming is not the same as verification, and verification is not the same as
source evidence. The product must keep these states distinct so a public user
can tell what came from public sources, what came from the subject, and what
Atlas reviewed.

Public and internal states:

- **Unclaimed:** No approved steward is attached to the profile.
- **Claim started:** A signed-in user has begun a claim. This is claimant-facing
  and reviewer-facing only.
- **Email verification needed:** The claimant must prove control of an eligible
  email or domain before the claim can proceed.
- **Manual review needed:** A reviewer must decide whether the claimant can
  steward the profile.
- **More information requested:** A reviewer needs additional proof before
  approving or denying the claim.
- **Verified steward:** Atlas has approved the claimant or delegate to manage
  subject-provided fields.
- **Denied:** The claim did not prove a sufficient connection.
- **Revoked:** A previously approved steward lost access because of role change,
  impersonation, misuse, dispute, account compromise, or expired proof.
- **Disputed:** More than one claimant, source, reviewer, or affected subject
  contests who should steward the profile.
- **Stale stewardship:** The steward has not reconfirmed their connection within
  the required window.

Public profiles may show only calm, useful states: unclaimed, subject-stewarded,
disputed, stale, or revoked when that context is needed for trust. They must not
show private claim workflow details, reviewer notes, private evidence, or the
identity of denied claimants.

## Claim Paths

1. Email domain proof
   - User signs in.
   - User submits claim for a profile.
   - Atlas checks whether the user's verified email domain reasonably matches
     the profile organization, website, or public contact surface.
   - Successful proof can verify low-risk organization claims.
   - Email domain proof cannot automatically verify person claims, delegate
     access, contested profiles, or high-risk profiles.

2. Manual evidence proof
   - User submits public evidence or private verification context.
   - Reviewer approves, requests more information, or denies.
   - Manual review is required for ambiguous person claims, high-risk profiles,
     disputed profiles, and delegate access.
   - Manual proof can verify person, organization, initiative, campaign, event,
     and delegate claims when the evidence establishes a current connection.

3. ATProto proof
   - User connects an ATProto handle.
   - Atlas resolves and stores the stable DID.
   - User proves control of the handle through OAuth or a profile-linked record
     when supported.
   - ATProto proof can strengthen a person or organization claim but should not
     override conflicting evidence by itself.
   - Handle changes do not break a verified claim when the DID remains stable,
     but the public profile should show a changed-handle state until Atlas
     refreshes the display identity.

## Verification Thresholds

Atlas should use the smallest proof path that protects the public trust
experience:

- Low-risk organization claims can be verified through matching verified email
  domain, organization website domain, SSO-admin approval, or manual review.
- Person claims default to manual review unless a future identity proof is
  explicitly approved for low-risk auto-verification.
- Initiative, campaign, event, and publication claims require either an
  organization steward with clear authority or manual review.
- Delegate access always requires approval from an existing steward, eligible
  organization admin, or reviewer.
- High-risk profiles require manual review even when technical proof succeeds.
- Conflicting sources, disputed ownership, stale public evidence, or safety
  flags block automatic verification.
- Workspace membership, private notes, saved lists, brief ownership, or customer
  workflows are never public proof by themselves.

## Claim Lifecycle

Atlas should keep one active claim per claimant and profile. New evidence from
the same claimant updates the active claim instead of creating parallel claims.

Initial workflow defaults:

- Email verification tokens expire after 7 days.
- Reviewer requests for more information expire after 30 days.
- Manual review should be triaged within 5 business days for ordinary claims and
  sooner for safety-sensitive or high-visibility profiles.
- Denied claims can be resubmitted when the claimant provides new evidence,
  unless the claimant or profile is under a safety restriction.
- Approval updates public stewardship state only after the reviewer or automatic
  rule records the proof path and decision.
- Revocation immediately removes steward editing access, freezes
  subject-provided fields, and hides preferred contact fields when safety or
  impersonation risk is present.

Claim transitions:

- `claim started` -> `email verification needed` when a low-risk organization
  claim has a plausible domain match.
- `claim started` -> `manual review needed` when the claim is a person,
  initiative, campaign, event, delegate, disputed, high-risk, or ambiguous
  claim.
- `email verification needed` -> `verified steward` only for low-risk
  organization claims with successful proof and no blocking risk signals.
- `email verification needed` -> `manual review needed` when proof succeeds but
  the profile, claimant, or source context needs review.
- `manual review needed` -> `more information requested`, `verified steward`,
  `denied`, or `disputed` by reviewer decision.
- `more information requested` -> `manual review needed` when the claimant
  responds before expiration.
- `verified steward` -> `stale stewardship` when reconfirmation expires.
- `verified steward` -> `revoked` when access is removed for safety, role,
  dispute, abuse, or account-integrity reasons.

## Stewardship Capabilities

Verified stewards can manage:

- Subject-provided bio.
- Profile image URL or approved image.
- Preferred public contact channel.
- Public website links.
- Pronouns or role language when appropriate.
- Organization delegate list.
- Correction requests.
- Source suppression requests for safety or irrelevance.
- Public preview of managed fields.

Verified stewards cannot directly remove:

- Source-backed public claims.
- Disputed claims that require review.
- Governance notes.
- Evidence metadata.
- Public safety warnings.

Steward-managed fields must be labeled as subject-provided wherever they appear.
They may improve representation, contact preferences, and current context, but
they cannot silently replace source-backed public evidence.

## User Experience

Claim start:

- Profile page has a clear claim action.
- Claim page shows profile preview, eligible proof paths, and expected review
  state.
- Signed-out users are asked to sign in only after choosing to claim.
- The proof path is described in plain language, not reviewer or protocol
  jargon.

Claim states:

- Not claimed.
- Claim started.
- Email verification needed.
- Manual review needed.
- More information requested.
- Verified.
- Denied.
- Revoked.
- Disputed.
- Stale stewardship.

Steward dashboard:

- Shows profile preview.
- Shows editable subject-managed fields.
- Shows correction and source-suppression status.
- Shows delegates for organizations.
- Shows last reconfirmed date.
- Shows public profile link.
- Shows pending reviewer requests and denied or revoked decisions in plain
  language.

Public profile presentation:

- Claim CTA is visible but quieter than the profile identity, evidence, and
  primary user actions.
- Verified stewardship appears near the profile trust summary.
- Subject-provided fields are visually distinct from source-backed claims.
- Disputed or stale stewardship appears as trust context, not as an alarm.
- Denied claims are not shown publicly.
- Revoked claims are shown only when hiding the revocation would mislead the
  public user.

## Data And Interfaces

Claim record:

- Claim id.
- Profile id.
- Requesting user id.
- Claim type.
- Proof path.
- Proof evidence metadata.
- Review state.
- Reviewer id when applicable.
- Decision reason.
- Created, updated, decided, and expires timestamps.

Claim proof record:

- Proof id.
- Claim id.
- Proof type.
- Linked identity id when applicable.
- Public evidence URL when supplied.
- Private evidence metadata when supplied.
- Proof status.
- Proof summary safe for reviewer use.
- Created, reviewed, and expires timestamps.

Claim review event:

- Event id.
- Claim id.
- Actor id.
- Event type.
- Public-safe summary when needed.
- Private reviewer note.
- Created timestamp.

Steward fields:

- Profile id.
- Steward user id.
- Steward role.
- Managed bio.
- Managed image.
- Preferred contact channel.
- Delegate permissions.
- Last reconfirmed timestamp.

ATProto identity fields:

- User id.
- Profile id when linked.
- DID.
- Current handle.
- PDS URL when known.
- Verification state.
- Last resolved timestamp.
- Last proof timestamp.

Public profile fields:

- Claim state.
- Stewardship state.
- Subject-provided field markers.
- Last steward reconfirmed timestamp when public-safe.
- Claim URL.
- Correction URL.
- Public dispute or stale-state label when needed.

Claimant-facing fields:

- Claim id.
- Profile preview.
- Proof path.
- Current state.
- Required next action.
- Reviewer message when supplied.
- Decision and resubmission eligibility.

Reviewer-facing fields:

- Claim id.
- Profile id and preview.
- Claimant identity and contact.
- Proof records.
- Risk state.
- Related open claims.
- Source and correction context.
- Decision actions.

## Safety And Abuse Handling

- Person claims require stricter review than organization domain claims.
- High-risk profiles can require manual review even after technical proof.
- Stewards can add subject voice but cannot erase public evidence without
  moderation review.
- Disputed ownership between multiple claimants goes to manual review.
- Claim revocation is available for impersonation, role changes, compromised
  accounts, or misuse.
- Source suppression requests must preserve internal audit history.
- Reviewer notes, private evidence, claimant contact information, and workspace
  context must not appear on public profiles or public exports.
- Public APIs may expose stewardship state and subject-provided field markers,
  but not private proof details or denied claimant identities.
- A steward cannot use managed fields to publish unsupported allegations, expose
  private personal information, or remove public-interest context.
- Correction, dispute, source-suppression, and restricted-use decisions follow
  the Governance, Corrections, And Safety PRD.

## Review Workflow

Reviewers can:

- Approve a claim.
- Deny a claim.
- Request more information.
- Mark a claim as disputed.
- Revoke stewardship.
- Approve or remove delegates.
- Escalate a claim for safety review.

Reviewer decisions must preserve audit history and explain the outcome to the
claimant in plain language. Denial messages should say what was missing without
revealing private reports, reviewer-only evidence, or safety-sensitive context.

Claims expire when the claimant does not complete the required next action
within the lifecycle windows above. Expired claims can be restarted unless the
profile or claimant is under a safety restriction.

## Reconfirmation

Stewardship should be periodically reconfirmed so Atlas does not show stale
subject control as current.

- Organization, initiative, campaign, event, and publication stewards reconfirm
  every 12 months.
- Person stewards and high-risk profiles reconfirm every 6 months.
- Stewards are prompted 30 days before the current proof expires.
- Organization stewards can reconfirm through domain, SSO-admin approval,
  delegate approval, ATProto proof, or manual review.
- Person stewards reconfirm through manual review, ATProto proof, or another
  approved identity proof.
- Stale stewardship locks editing until reconfirmed.
- Public profiles can show stale stewardship when the state affects trust in
  subject-provided fields.

## Metrics

- Claim starts per eligible profile.
- Verification completion rate by proof path.
- Manual review turnaround time.
- Correction resolution time for claimed profiles.
- Reconfirmation completion rate.
- Claim dispute and revocation count.
- Public profile views that lead to source inspection after seeing a stewarded
  field.
- Denied or revoked claims caused by impersonation, stale role, or delegate
  misuse.

## Acceptance Criteria

- A signed-in subject can start a claim from a public profile.
- Email domain, manual evidence, and ATProto proof paths are represented.
- Claim status is visible to the claimant.
- Verified stewards can edit subject-managed fields and preview the profile.
- Public profiles show claimed or stewarded state without overstating review.
- Reviewers can deny, approve, request more information, or revoke claims.
- Person claims, high-risk profiles, contested profiles, and delegate access do
  not auto-verify from email domain proof alone.
- Public users can distinguish source-backed claims from subject-provided
  fields.
- Private proof details, reviewer notes, and denied claimant identities never
  appear on public profiles, public exports, or public APIs.
- Disputed, revoked, and stale stewardship states are represented without
  exposing private workflow details.
- Claim proof, review event, public profile, claimant-facing, and
  reviewer-facing data needs are specified for implementation planning.
- A claimant chooses from ATProto identities already connected in Account; claim
  drafts persist the durable identity selection.
- Organization representatives can combine an ATProto identity with domain or
  additional relationship proof without treating the provider as authority.
- A verified steward can attach, replace, or remove a public profile identity
  without disconnecting it from the controlling user's Account.
- A public profile exposes identity relationship health but never private
  controller metadata or a stale application-specific link.
