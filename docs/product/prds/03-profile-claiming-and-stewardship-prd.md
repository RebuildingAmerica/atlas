# Profile Claiming And Stewardship PRD

Status: Draft
Date: 2026-07-03
Owner: Rebuilding America Project

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

## Claim Paths

1. Email domain proof
   - User signs in.
   - User submits claim for a profile.
   - Atlas checks whether the user's verified email domain reasonably matches
     the profile organization, website, or public contact surface.
   - Successful proof can verify low-risk organization claims.

2. Manual evidence proof
   - User submits public evidence or private verification context.
   - Reviewer approves, requests more information, or denies.
   - Manual review is required for ambiguous person claims, high-risk profiles,
     disputed profiles, and delegate access.

3. ATProto proof
   - User connects an ATProto handle.
   - Atlas resolves and stores the stable DID.
   - User proves control of the handle through OAuth or a profile-linked record
     when supported.
   - ATProto proof can strengthen a person or organization claim but should not
     override conflicting evidence by itself.

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

## User Experience

Claim start:

- Profile page has a clear claim action.
- Claim page shows profile preview, eligible proof paths, and expected review
  state.
- Signed-out users are asked to sign in only after choosing to claim.

Claim states:

- Not claimed.
- Claim started.
- Email verification needed.
- Manual review needed.
- More information requested.
- Verified.
- Denied.
- Revoked.

Steward dashboard:

- Shows profile preview.
- Shows editable subject-managed fields.
- Shows correction and source-suppression status.
- Shows delegates for organizations.
- Shows last reconfirmed date.
- Shows public profile link.

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

## Safety And Abuse Handling

- Person claims require stricter review than organization domain claims.
- High-risk profiles can require manual review even after technical proof.
- Stewards can add subject voice but cannot erase public evidence without
  moderation review.
- Disputed ownership between multiple claimants goes to manual review.
- Claim revocation is available for impersonation, role changes, compromised
  accounts, or misuse.
- Source suppression requests must preserve internal audit history.

## Metrics

- Claim starts per eligible profile.
- Verification completion rate by proof path.
- Manual review turnaround time.
- Correction resolution time for claimed profiles.
- Reconfirmation completion rate.
- Claim dispute and revocation count.

## Acceptance Criteria

- A signed-in subject can start a claim from a public profile.
- Email domain, manual evidence, and ATProto proof paths are represented.
- Claim status is visible to the claimant.
- Verified stewards can edit subject-managed fields and preview the profile.
- Public profiles show claimed or stewarded state without overstating review.
- Reviewers can deny, approve, request more information, or revoke claims.
