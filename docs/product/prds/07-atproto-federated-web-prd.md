# ATProto Federated Web PRD

Status: Draft
Date: 2026-07-03
Owner: Rebuilding America Project

## User Outcome

Atlas users and profile subjects can use ATProto identity to strengthen profile
claims, public provenance, and civic contribution paths while Atlas keeps review
authority over what becomes a source-backed fact.

## Protocol Context

AT Protocol accounts have persistent decentralized identifiers and mutable
human-readable handles. User data lives in signed repositories hosted by
Personal Data Servers, and the network separates PDS hosting, relays, AppViews,
feeds, and labelers. Lexicons define interoperable record and API schemas using
reverse-DNS names.

Primary references:

- [AT Protocol overview](https://atproto.com/guides/overview)
- [DID specification](https://atproto.com/specs/did)
- [Lexicons guide](https://atproto.com/guides/lexicon)
- [OAuth guide](https://atproto.com/guides/oauth)

## Product Position

ATProto is not Atlas's database. It is a federated identity, provenance,
distribution, and contribution layer. Atlas should use it to make civic records
more user-owned, more portable, and easier to verify, without letting social
posts automatically become Atlas facts.

## Users

- Profile subject proving control of a public identity.
- Public user seeing that a profile is linked to a verified handle.
- Civic actor submitting a source through a federated identity.
- Atlas reviewer evaluating ATProto-sourced evidence.
- Developer or civic technologist building interoperable Atlas tools.

## Core Requirements

1. Connect ATProto identity
   - User enters or authorizes an ATProto handle.
   - Atlas resolves the handle to a DID.
   - Atlas stores the DID as the stable identifier and stores the current handle
     as display metadata.
   - Atlas re-resolves handles periodically and displays changed or failed
     resolution states.

2. Use ATProto for profile claims
   - A connected ATProto identity can be used as one proof path in profile
     claiming.
   - Proof can support person, organization, initiative, or publication
     representation when the handle is publicly connected to the profile.
   - ATProto proof does not override conflicting evidence or high-risk manual
     review.

3. Display verified ATProto identity
   - Claimed profiles can show a linked handle and verification state.
   - Display must make the DID-backed nature clear enough for trust without
     making the UI technical.
   - Handle changes should not break profile linkage.

4. Source submissions from ATProto
   - Users can submit an ATProto post, record, or URL as a source candidate.
   - Candidate records enter review before affecting profiles or search.
   - Accepted records preserve AT URI, CID, author DID, collection, record key,
     indexed timestamp, and reviewer state.

5. Public Field Notes distribution
   - Atlas can publish or mirror reviewed public updates to ATProto.
   - Outbound records should link back to Atlas source-backed pages.
   - Publishing must not leak private workspace information.

6. Future custom feeds
   - Atlas can provide feeds for civic discovery, such as new source-backed
     profiles in a place, issue updates, or directory changes.
   - Feed ranking must preserve trust and safety rules.

7. Future Atlas Lexicons
   - Custom Lexicons should wait until identity, claims, and source-submission
     behavior is stable.
   - Candidate NSIDs:
     - `org.rebuildingamerica.atlas.profileClaim`
     - `org.rebuildingamerica.atlas.sourceSubmission`
     - `org.rebuildingamerica.atlas.fieldNote`
     - `org.rebuildingamerica.atlas.directoryContribution`

## Data And Interfaces

ATProto identity:

- User id.
- Linked Atlas profile id when applicable.
- DID.
- Current handle.
- PDS URL when known.
- Verification state.
- Last resolved timestamp.
- Last proof timestamp.
- Resolution error state.

ATProto source candidate:

- Candidate id.
- AT URI.
- CID.
- Author DID.
- Current author handle.
- Collection NSID.
- Record key.
- Submitted by user id.
- Indexed timestamp.
- Review state.
- Linked source id after acceptance.
- Linked evidence id after acceptance.

ATProto outbound artifact:

- Atlas artifact id.
- Artifact type.
- AT URI.
- CID.
- Collection NSID.
- Record key.
- Published timestamp.
- Sync state.

## User Experience

- Use "Connect ATProto" or "Connect Bluesky/ATProto identity" depending on
  product context.
- Explain that Atlas stores the stable identity, not just the display handle.
- Do not require users to understand DIDs to claim a profile.
- Use concise trust language, such as "Verified linked handle" and "Handle
  changed since verification."
- Source submissions from ATProto should feel like submitting a receipt, not
  publishing directly into the civic graph.

## Safety And Trust

- ATProto posts are source candidates, not facts.
- Follows, likes, reposts, quote posts, and social proximity do not establish
  civic alignment by themselves.
- Deleted, unavailable, or handle-changed records must remain reviewable by
  stored AT URI, CID, DID, and review metadata.
- Harassment, doxxing, private-person targeting, and unsupported allegations are
  rejected or escalated.
- Atlas must not publish private workspace notes to ATProto.

## Metrics

- Connected ATProto identities.
- Claim completions using ATProto proof.
- Handle resolution failures.
- ATProto source submissions.
- Accepted source candidates.
- Correction rate on ATProto-sourced records.
- Outbound Field Note engagement that leads back to Atlas.

## Acceptance Criteria

- A user can connect an ATProto handle and Atlas stores the resolved DID.
- A profile claim can use ATProto proof as one verification path.
- A claimed profile can display a verified linked handle.
- Handle changes do not break DID-based linkage.
- ATProto source submissions enter review and do not modify profiles directly.
- Accepted ATProto source candidates preserve AT URI, CID, DID, collection, and
  review metadata.
