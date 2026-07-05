# Trust, Safety, And Verification System

Status: Product architecture reference
Last updated: 2026-07-05
Audience: Product, engineering, review, policy, partnerships, and operators

## Purpose

Atlas publishes source-linked information about real civic actors. The trust
system exists so a public user can answer five questions quickly:

1. Who or what does this profile represent?
2. What public evidence supports each important claim?
3. How current, direct, complete, and disputed is that evidence?
4. Who is allowed to steward the profile or workspace?
5. Which parts were verified by automation, which parts were reviewed by a
   human, and which parts remain uncertain?

The system is deliberately layered because no single proof answers all trust
questions. A passkey can prove control of an Atlas account. A DNS record can
prove control of a domain. A W3C Verifiable Credential can prove that an issuer
made a signed statement about a holder or subject. A public source can support a
profile claim. A Rebuilding America reviewer can decide that the evidence is
sufficient for a specific action. None of those alone makes every public claim
true, current, complete, safe, or endorsed.

Atlas should therefore present trust as a visible product experience, not as a
hidden backend score. The public user should be able to inspect the trail, see
uncertainty, and act with the right level of care.

## Governing Principle

Trust is the core Atlas experience. A confident, wrong, stale, or unsourced
profile is the worst outcome because it fails the user at the exact moment the
product asks for belief.

Every trust component must protect a user-visible outcome:

- Public users can find civic actors without guessing why a result appeared.
- Profile subjects can correct, claim, or contest their public presence.
- Reviewers can slow down risky publication before harm reaches the public map.
- Workspace users can collaborate privately without private notes becoming
  public evidence.
- API and export users receive provenance, limits, and safety context instead
  of detached rows.

## System Map

| Layer | Component                                                     | Primary question answered                                                      | Does not answer                                                                  |
| ----- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 1     | Public evidence and provenance                                | What source supports this claim?                                               | Whether every statement in the source is true, complete, current, or neutral.    |
| 2     | Discovery publication gate                                    | Can this discovered record publish without review?                             | Whether the subject endorses the profile or can steward it.                      |
| 3     | Profile trust presentation                                    | Can a user see evidence, freshness, dispute, and stewardship state?            | Whether an unshown private workflow makes a public claim true.                   |
| 4     | Account identity and auth                                     | Which Atlas account or API actor is making this request?                       | Whether the user is the real-world subject of a profile.                         |
| 5     | Workspace authorization                                       | Is this user allowed into this workspace or team workflow?                     | Whether the workspace controls a public profile or domain.                       |
| 6     | Domain and organization proof                                 | Does a user or workspace control an email/domain proof channel?                | Whether a person is who they say they are, or whether every org role is current. |
| 7     | Profile claiming and stewardship                              | Who may manage subject-provided profile fields?                                | Ownership of the public facts or removal power over source-backed evidence.      |
| 8     | Real-world identity and representative authority              | Is the claimant the subject, a current representative, or a delegated steward? | Whether every claim on the profile is correct.                                   |
| 9     | Human review and staff attestation                            | Has a qualified reviewer approved this action from sufficient evidence?        | A blanket guarantee of truth, safety, or endorsement.                            |
| 10    | Corrections, disputes, suppression, and restricted-use safety | What should change, slow down, or stay private to prevent harm?                | A promise that Atlas can resolve every outside conflict.                         |
| 11    | Federation, credentials, and portable identity                | What external identity or credential proof can strengthen a claim?             | Automatic public truth or universal account recovery.                            |
| 12    | API, MCP, exports, and reuse                                  | Can downstream users preserve provenance and limits?                           | Permission to strip evidence or use Atlas for restricted targeting.              |

## Trust Vocabulary

**Source**

A public artifact that supports or contextualizes a profile, relationship, role,
location, issue, contact surface, initiative, directory entry, or claim. Sources
can include organization websites, public rosters, public filings, local news,
public meeting records, campaign pages, social posts, or reviewed submitted
materials.

**Evidence**

The connection between a source and a specific claim. Evidence includes the
source URL, title, publisher when known, publication or observed date, retrieved
date when available, extraction context, confidence or review state, and the
relationship between the source and the claim.

**Claim**

A factual assertion Atlas shows or stores about a civic actor. Examples include
name, role, issue area, affiliation, location, contact surface, initiative
participation, relationship to another actor, or directory inclusion.

**Profile**

The public civic object representing a person, organization, initiative,
campaign, event, publication, or other supported actor type. A profile is not a
login account and not owned by the subject. It is a source-linked public record
with correction and stewardship paths.

**Steward**

An approved subject, organization representative, or delegate who can manage
subject-provided profile fields. Stewardship is deliberately narrower than
ownership. A steward can improve direct information, but cannot erase
source-backed evidence, disputed claims, safety context, or governance history
without review.

**Verification**

A decision that a proof meets the threshold for a specific action. Verification
is scoped. "Verified email domain," "verified workspace domain," "verified
steward," "verified linked handle," and "reviewer-approved claim" mean
different things and must not be collapsed into one generic badge.

**Real-world identity**

Evidence that an Atlas account is controlled by the person it claims to
represent, or by a person currently authorized to act for an organization,
initiative, campaign, event, publication, or profile subject.

**Representative authority**

Evidence that a claimant can act for an organization or managed public presence.
This can come from current public role evidence, domain or SSO-admin control,
existing steward approval, reviewer confirmation, ATProto organization identity,
or future credential proof.

**Human attestation**

A decision recorded by a Rebuilding America reviewer or authorized operator that
the evidence is sufficient for a specific trust action. It is not a claim that
every public source is true, every profile field is current, or Rebuilding
America endorses the subject.

**Credential proof**

A signed credential or presentation, such as a W3C Verifiable Credential
presented through the Digital Credentials API or OpenID for Verifiable
Presentations. Credential proof can strengthen identity or authority decisions
when the issuer, subject binding, freshness, revocation status, and requested
claims are appropriate.

**Dispute**

A state where a profile, claim, source, steward, or requested action is
contested by a subject, claimant, reviewer, source evidence, or other affected
party.

**Suppression**

A safety or relevance decision to hide, remove, or limit a source or field from
public display. Suppression does not necessarily delete internal audit history.

**Private evidence**

Proof submitted for review but not safe or necessary for public display. Private
evidence can support reviewer decisions, but public profiles should not ask
users to trust claims that only exist inside private workflows.

## Layer 1: Public Evidence And Provenance

### User Outcome

A public user can inspect why a profile or claim appears and decide whether it
is strong enough for their next action.

### Components

- Source records with URL, title, publisher, source type, publication or
  observed date, retrieved date, and raw or summarized context.
- Entry-source links that connect sources to profiles and claims.
- Extraction context that explains why the source was connected to the actor.
- Evidence packs on profiles that group sources by claim, relationship, issue,
  and freshness.
- Public source inspection from search results, profile pages, directories, and
  API responses.

### Evidence States

| State                        | Meaning                                                                           | User handling                                                  |
| ---------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Single source                | One public mention or page supports the claim.                                    | Treat as a lead. Inspect before high-stakes use.               |
| Multiple independent sources | Several sources support the same actor or claim.                                  | Higher confidence when publishers and source types differ.     |
| Recent source                | The source was published or observed recently.                                    | More actionable, but still scoped to what the source says.     |
| Old source                   | The strongest support is months or years old.                                     | Treat current activity, contact, and role as uncertain.        |
| Structured source            | The source is a roster, table, directory, filing, partner list, or contact block. | Stronger for existence and affiliation than for impact claims. |
| Partial source               | The source supports only part of the profile.                                     | Do not infer unsupported details.                              |
| Disputed source              | A subject, reviewer, or other evidence contests the source or its interpretation. | Show visible trust context and route to review.                |
| Suppressed source            | A reviewer limited display for safety, privacy, relevance, or misuse concerns.    | Preserve audit history while avoiding unsafe public exposure.  |

### Rules

- Every important public claim needs evidence, confidence, or an explicit
  unknown state.
- Public profiles must distinguish source-backed claims from subject-provided
  fields.
- A source can support a claim without proving all claims in the profile.
- A source can be public and still unsafe to display in a particular context.
- Private workspace notes do not become public evidence unless deliberately
  published through an approved path.
- Public API and export surfaces must preserve source IDs, source dates,
  confidence or review state, and claim relationships when those fields exist.

### Failure Modes

- Showing a weak allegation as a profile fact.
- Treating a stale source as current role evidence.
- Detaching exported rows from provenance.
- Letting one source imply endorsement, membership, or employment beyond what
  it says.
- Hiding uncertainty behind a generic confidence score.

## Layer 2: Discovery Pipeline And Publication Gate

### User Outcome

New records should appear only when Atlas has enough evidence to avoid
confidently publishing risky or duplicate information.

### Current Gate

The discovery publication gate is intentionally conservative:

- Possible duplicates are always held because merging records is a reviewer
  decision.
- People are always held because wrong facts about named individuals are the
  core liability.
- Organizations can auto-publish only when corroborated by an authoritative
  registry such as EIN, Form 990, or FEC data.
- Everything else is held as uncorroborated web-only.

The current code keeps the gate pure and testable: the caller supplies entity
kind, registry corroboration, duplicate suspicion, and score; the gate returns a
publish or hold decision with a machine-readable reason.

### Hold Reasons

| Hold reason               | Meaning                                         | Reviewer need                                                       |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| `dedup_suspect`           | The new record may duplicate an existing actor. | Decide merge, alias, reject, or separate profile.                   |
| `person_requires_review`  | The entity is a named person.                   | Confirm identity, source quality, safety context, and public value. |
| `uncorroborated_web_only` | The record lacks authoritative corroboration.   | Decide whether sources are sufficient, stale, or unsafe.            |

### Publication Rules

- A strong discovery score is not enough to bypass the gate.
- Deduplication risk outranks confidence.
- Person records require human review even when sources look direct.
- Registry corroboration can support organization auto-publication, but does
  not prove current staff roles, endorsement, impact, or contact accuracy.
- A held record should keep enough source metadata for reviewers to resolve it
  without repeating the discovery work.

### Future Additions

- Registry connectors for IRS/Form 990, FEC, state business registries, and
  other authoritative public datasets.
- Risk signals for sensitive roles, minors, private addresses, vulnerable
  communities, law-enforcement surveillance risk, and harassment patterns.
- Review queue metrics for hold volume, resolution time, reversal rate, and
  downstream corrections.

## Layer 3: Profile Trust Presentation

### User Outcome

A user opening a profile can see identity, civic work, place, evidence,
freshness, claim state, stewardship, and correction paths without needing to
understand internal pipelines.

### Components

- Profile header with identity, actor type, place, issue areas, trust summary,
  latest source date, and primary actions.
- Evidence section or drawer grouped by claim and source.
- Relationship previews that keep source links attached.
- Freshness and gap indicators.
- Claim and correction actions.
- Stewardship state near the trust summary.
- Public profile history signals when they help trust.

### Public Trust States

Public labels should be scoped and calm. Useful states include:

- Source-linked.
- Single-source.
- Multiple-source.
- Recent source.
- Older source.
- Partial support.
- Subject-stewarded.
- Subject-provided.
- Under review.
- Disputed.
- Corrected.
- Suppressed.
- Stale stewardship.

Avoid generic labels that overclaim, such as "verified profile," unless the UI
also says what was verified. The safer pattern is scoped language:

- "Verified linked handle" for ATProto or similar identity linkage.
- "Verified workspace domain" for SSO domain proof.
- "Subject-stewarded" for approved profile management.
- "Reviewed by Rebuilding America" only when a reviewer approved the specific
  action being described.

### User-Facing Boundaries

The public profile should never show:

- Private proof documents.
- Reviewer notes.
- Denied claimant identities.
- Reporter identities.
- Internal risk scores.
- Workspace-only notes, briefs, lists, renewal packets, or usage proof.
- Claims that exist only in private workflows.

### Trust Copy Rules

- Say what is known, what is disputed, what is stale, and what is missing.
- Do not narrate internal collection or pipeline behavior in public empty
  states.
- Do not treat a client, sponsor, workspace, or reviewer workflow as proof that
  a public claim is true.
- Do not imply endorsement or membership without evidence.
- Make uncertainty inspectable rather than decorative.

## Layer 4: Account Identity And Authentication

### User Outcome

Atlas knows which account, browser session, API actor, or integration is taking
an action, and can enforce the right access policy.

### Current Components

Atlas uses a split auth architecture:

- The app server owns user identity and sessions through Better Auth.
- The API server verifies credentials and enforces access.
- The app issues JWT or OAuth access tokens.
- The API verifies JWTs through JWKS.
- API keys are introspected through an app-server callback.
- Organization membership is verified through an app-server callback.
- Internal app-to-API calls use a shared internal secret.

Supported sign-in and access methods include:

- Passkey/WebAuthn.
- Magic link.
- Enterprise SSO through OIDC or SAML.
- OAuth access token for MCP clients and third-party apps.
- API key for programmatic access.
- Internal secret for trusted service calls.

### What This Proves

- Control of an Atlas session.
- Control of a passkey or email link.
- Possession of an OAuth access token or API key.
- Membership in a workspace when the app confirms it.
- API capability based on active products, role, and org context.

### What This Does Not Prove

- That the user is the real-world subject of a public profile.
- That the user can represent an organization publicly.
- That the user controls a public website domain.
- That the user can edit source-backed facts.
- That a private workspace claim is public evidence.

### Rules

- Account identity is necessary for stewardship and corrections, but not
  sufficient for public verification.
- API actor identity must travel with moderation-sensitive actions.
- Workspace membership can support representative authority, but only when the
  workspace, role, and profile relationship make sense.
- Atlas should avoid treating email as the canonical identity forever. It is one
  identity proof among several.

## Layer 5: Workspace Authorization And Private Trust Boundary

### User Outcome

Teams can collaborate, save, enrich, and review civic information without
accidentally changing what public users are asked to believe.

### Components

- Better Auth organization records.
- Workspace memberships, roles, and invitations.
- Capability resolution from active products.
- Private workspace artifacts such as lists, briefs, notes, coverage targets,
  renewal packets, usage proof, and partner workflows.
- API and MCP access scoped by org, role, capability, and resource.

### Public/Private Boundary

Public Atlas records are built from public evidence and approved stewardship
fields. Workspace artifacts belong to the workspace unless a user deliberately
publishes a supported object through a public path.

This boundary protects both sides:

- Public users are not asked to trust claims that only exist in private customer
  workflows.
- Workspace users can plan, annotate, and research without leaking private
  context into the public map.

### Rules

- Private notes cannot silently become public source evidence.
- Workspace membership cannot automatically verify public profile stewardship.
- Enterprise SSO authorizes workspace access, not public civic identity.
- API exports must preserve visibility boundaries.
- Public user trust must not depend on a private record they cannot inspect.

## Layer 6: Domain And Organization Verification

### User Outcome

When Atlas uses domain control as proof, the proof should mean exactly that: the
claimant or workspace can control the relevant DNS, email domain, or verified
organization-admin path.

### Domain Proof Types

| Proof type                           | Current support                                                                                                                                     | Proves                                                                                                     | Does not prove                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Workspace SSO domain verification    | Supported through Better Auth domain verification.                                                                                                  | A workspace admin can publish the required DNS TXT record or otherwise satisfy Better Auth's domain check. | Public profile stewardship, real-world identity, or current role.              |
| Profile email-domain match           | Supported as tier-one claim routing for low-risk organization claims.                                                                               | The claimant controls an email address whose domain matches profile email or website domains.              | Domain ownership, person identity, high-risk authority, or delegate authority. |
| Public directory custom domain token | Supported, but currently weak because verification compares a submitted TXT value to the stored token instead of performing server-side DNS lookup. | Token possession in the current implementation.                                                            | Actual DNS control unless upgraded to authoritative lookup.                    |
| Organization website domain proof    | Specified as a low-risk organization claim path.                                                                                                    | Control or credible connection to the organization's public web domain.                                    | Person identity or unrestricted profile editing.                               |
| SSO-admin approval                   | Specified as a low-risk organization and reconfirmation path.                                                                                       | A verified workspace admin approved the relationship.                                                      | Independent public source truth.                                               |

### Required Fix

The public directory custom-domain path should perform server-side DNS TXT
lookup against the configured domain before marking the domain verified. A
client-submitted TXT record should be treated as input to verify, not as proof by
itself.

### Rules

- Domain control can verify organization authority only for low-risk cases.
- Domain control cannot automatically verify person claims.
- Domain control cannot override conflicting source evidence or disputes.
- Domain proof should expire or reconfirm when the related stewardship state
  expires.
- A domain that supports SSO should not automatically become a public directory
  or profile domain without an explicit product action.

## Layer 7: Profile Claiming And Stewardship

### User Outcome

A person or organization represented in Atlas can claim a profile, prove a
relationship, and maintain subject-managed information without weakening the
source-backed trust model.

### Current Claim Paths

1. Email domain proof.
2. Manual evidence review.
3. ATProto proof, specified for future support.
4. W3C Verifiable Credential proof, recommended as a future verifier-first
   path.

### Trust State Contract

Claiming is not the same as verification, and verification is not the same as
ownership. The claim system should track:

- Unclaimed.
- Claim started.
- Email verification needed.
- Manual review needed.
- More information requested.
- Verified steward.
- Denied.
- Revoked.
- Disputed.
- Stale stewardship.

Public profiles may show only public-safe states:

- Unclaimed.
- Subject-stewarded.
- Disputed.
- Stale.
- Revoked, when hiding revocation would mislead the user.

### Verification Thresholds

- Low-risk organization claims can use matching verified email domain,
  organization website domain, SSO-admin approval, or manual review.
- Person claims default to manual review unless a future proof path is
  explicitly approved for low-risk auto-verification.
- Initiative, campaign, event, and publication claims require either an
  organization steward with clear authority or manual review.
- Delegate access always requires approval from an existing steward, eligible
  organization admin, or reviewer.
- High-risk profiles require manual review even when technical proof succeeds.
- Disputes, duplicate risk, conflicting sources, safety reports, or suppression
  flags block automatic verification.

### Steward Capabilities

Verified stewards can manage subject-provided fields, such as:

- Preferred public contact channel.
- Pronouns or public display preferences, where supported.
- Subject-provided description.
- Current website or social links.
- Profile photo or logo, when supported.
- Suggested issue tags or service areas.
- Public preview of managed fields.

Verified stewards cannot directly remove or rewrite:

- Source-backed public claims.
- Source metadata.
- Disputed claims that require review.
- Correction or moderation history.
- Public safety warnings.
- Relationship evidence.
- Reviewer-only decisions.
- Other stewards.
- Atlas methodology or confidence states.

### Lifecycle

- One active claim per claimant and profile.
- New evidence from the same claimant updates the active claim.
- Email verification tokens expire after 7 days.
- More-information requests expire after 30 days without response.
- Ordinary manual claims should be triaged within 5 business days.
- Person claims and safety-sensitive claims should be triaged sooner when risk
  signals exist.
- Denied claims can be resubmitted with new evidence unless a safety restriction
  blocks it.
- Approval updates public stewardship state only after the required proof or
  reviewer action succeeds.
- Revocation immediately removes steward editing access and freezes
  subject-managed fields until review or reconfirmation.

### Reconfirmation

- Organization, initiative, campaign, event, and publication stewards reconfirm
  every 12 months.
- Person stewards and high-risk profiles reconfirm every 6 months.
- Reminder notices go 30 days before expiration.
- Stale stewardship locks editing until reconfirmed.
- Public profiles can show stale stewardship when it affects trust in
  subject-provided fields.

## Layer 8: Real-World Identity, Representative Authority, And Human Review

### User Outcome

Actions that materially affect public trust are approved by a real person when
automation cannot safely decide.

### Identity Axes

Atlas should model these axes separately:

1. Account identity: who is signed in.
2. Profile stewardship: who may manage subject-provided fields.
3. Real-world subject identity: whether the account is controlled by the person
   represented by the profile.
4. Representative authority: whether the claimant currently acts for an
   organization, initiative, campaign, event, or publication.
5. Public identity continuity: whether a durable public identity, such as an
   ATProto DID, remains linked over time.
6. Proof provenance: which proof established which scoped decision.
7. Atlas authorization: what the user can do inside Atlas after the decision.
8. Human attestation: whether Rebuilding America staff or authorized reviewers
   approved a specific trust action.

### Legal Association Evidence

Atlas should not use "legally associated" as a single public label. It is too
broad. The system should store and display the specific association that a
source supports:

- Listed as officer.
- Listed as director.
- Listed as trustee.
- Listed as key employee.
- Listed as registered agent.
- Listed as committee treasurer.
- Listed as committee custodian of records.
- Listed as lobbyist for a client.
- Listed as union officer or employee.
- Listed as public-company director or executive officer.
- Listed as public body appointee, board member, commissioner, or official.
- Approved organization steward.
- Organization-issued credential holder.
- Delegate approved by an existing verified steward.

The public-safe phrasing should include the source and time scope:

- "Listed as treasurer in a 2026 FEC committee filing."
- "Listed as director in the organization's FY2024 Form 990."
- "Listed as registered agent in the Nevada business registry."
- "Approved as an organization steward after Rebuilding America review."

Avoid broad labels such as "legally verified," "verified employee," or "legal
representative" unless the evidence source actually says that and the time
period is current enough for the action.

### Legal Association Source Hierarchy

| Tier | Source type                                                                                                                                                | Use for                                                       | Limitations                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1    | Official government filing naming the person, organization, role, jurisdiction, and filing period.                                                         | Strongest public evidence for a scoped role claim.            | Often stale, role-specific, and not proof of ongoing employment or broad authority.               |
| 2    | Organization-controlled official source, such as staff page, board page, official domain email, signed statement, SSO-admin approval, or DNS/domain proof. | Current operational association and stewardship authority.    | Not always a legal filing; can change without public audit history.                               |
| 3    | Private proof reviewed by Atlas, such as board resolution, HR letter, contract, organization-issued W3C credential, or direct staff confirmation.          | Stewardship, delegate authority, and sensitive current roles. | Usually not public evidence; store metadata and review decision, not unnecessary raw PII.         |
| 4    | Secondary public sources, such as ProPublica Nonprofit Explorer, Candid, OpenCorporates, Ballotpedia, press, LinkedIn, or archived pages.                  | Discovery, corroboration, and source leads.                   | Prefer the underlying official filing for public proof. Do not use alone for high-risk decisions. |

### Public Data Sources For Legal Association

| Organization or role context                                                                                         | Primary source                                                                                                                                                                                                                                               | Supported claim                                                                                                                                           | Atlas handling                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tax-exempt nonprofit officer, director, trustee, key employee, or highly compensated employee                        | [IRS Tax Exempt Organization Search](https://www.irs.gov/charities-non-profits/search-for-tax-exempt-organizations), Form 990 series returns, and Form 990 XML data.                                                                                         | A person was reported by the organization in the named Form 990 role for the tax year or reporting period.                                                | Strong public evidence. Display tax year and role. Do not treat as current without freshness check because Form 990s can lag.                                                          |
| Tax-exempt nonprofit existence, exemption status, EIN, ruling date, subsection, and revocation status                | [IRS Exempt Organizations Business Master File Extract](https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf), Pub. 78, automatic revocation list, and determination letters.                                  | The organization exists as a tax-exempt entity or had a recognized exemption state.                                                                       | Good organization corroboration. Does not usually prove a person's association.                                                                                                        |
| State corporation, LLC, nonprofit corporation, or foreign-qualified entity officer/director/manager/registered agent | State Secretary of State or corporations division business registry, annual reports, statements of information, officer filings, registered-agent filings, and entity history.                                                                               | A person or registered-agent entity was listed in a specific official role for the entity in that jurisdiction.                                           | Strong role evidence when the registry names the person. Normalize jurisdiction, entity ID, filing type, filing date, and role. Coverage and role fields vary by state.                |
| State charity registration, charitable solicitation, fundraiser, or trust registration                               | State Attorney General or charity bureau registries, such as California DOJ Registry of Charities and Fundraisers, New York Charities Bureau, Illinois AG charity database, Minnesota AG charity search, Ohio AG charity records, and similar state systems. | The organization is registered or compliant for charitable activity; filings may name officers, directors, trustees, fundraisers, or responsible parties. | Strong organization compliance evidence and sometimes role evidence. Use the attached filing when a person claim depends on it. Note exemptions and delinquency/suspension states.     |
| Federal campaign committee officer or responsible person                                                             | [FEC data and filings](https://www.fec.gov/data/browse-data/), including committee statements of organization and amendments.                                                                                                                                | A person was listed as committee treasurer, assistant treasurer, custodian of records, candidate, or other committee role.                                | Strong public evidence for federal campaign roles. Display committee ID, form, amendment date, and role. Do not use contributor employer/occupation fields as legal association proof. |
| Federal lobbying registrant, lobbyist, client, or covered official relationship                                      | [U.S. Senate LDA reports](https://lda.senate.gov/) and House/Senate Lobbying Disclosure Act filings.                                                                                                                                                         | A registrant, client, and named lobbyist relationship was reported for a filing period.                                                                   | Strong role evidence for lobbying work and client representation. Display filing type, registration/report ID, period, client, registrant, and lobbyist name.                          |
| Labor union officer, employee, trusteeship, or labor organization role                                               | [U.S. Department of Labor OLMS Public Disclosure Room](https://www.dol.gov/agencies/olms/public-disclosure-room) and LM reports.                                                                                                                             | A person was listed as a union officer or employee in a labor-management filing.                                                                          | Strong source for union roles. Display union file number, filing year, form type, officer/employee role, and compensation context only when necessary.                                 |
| Public company director, executive officer, named executive officer, insider, or board nominee                       | [SEC EDGAR filing search](https://www.sec.gov/search-filings), especially DEF 14A proxy statements, 10-Ks, 8-Ks, Forms 3/4/5, and Schedule 13D/G where relevant.                                                                                             | A person was listed in a public-company filing in a specific governance, executive, ownership, or nominee role.                                           | Strong public-company evidence. Display filing type, accession number, period or event date, company CIK, and role. Do not generalize securities ownership into operational authority. |
| Federal contractor, grant recipient, or award recipient entity                                                       | [SAM.gov entity information](https://sam.gov/entity-information) and [USAspending.gov](https://www.usaspending.gov/).                                                                                                                                        | The organization is registered for federal awards or appears as an award recipient/subrecipient.                                                          | Good organization evidence. Usually weak for person-role evidence because public award data often names entities, not current individual authority.                                    |
| Public agency, commission, school board, advisory board, or appointed civic body                                     | Official government roster, appointment record, meeting minutes, board agenda, ordinance, resolution, or agency directory.                                                                                                                                   | A person was appointed, elected, employed, or listed in a specific public role.                                                                           | Strong when the source is an official government page or filing. Display body, jurisdiction, role, date appointed/elected, term if available, and source date.                         |
| Court filing, administrative proceeding, consent decree, or legal representation record                              | Official court docket, agency enforcement docket, consent order, signed filing, or attorney-of-record record.                                                                                                                                                | A person or firm appeared in a legally filed role in a proceeding.                                                                                        | High-risk. Use for specific legal-proceeding context only, usually with human review. Do not turn into broad organization association without independent proof.                       |
| Professional license board or regulated-entity registry                                                              | State professional licensing boards, contractor license boards, health facility registries, insurance producer registries, real-estate broker records, and similar official registries.                                                                      | A person or responsible licensee is associated with a regulated firm, facility, license, or business location.                                            | Strong only for the regulated role. Display license type, license number, status, jurisdiction, and effective/expiration dates.                                                        |
| Organization website, staff page, board page, press release, official social profile, or public email domain         | Organization-controlled public web source.                                                                                                                                                                                                                   | Current claimed role, staff position, board membership, public contact, or operational association.                                                       | Useful current evidence and stewardship signal. Weaker than filings for legal role proof; archive and timestamp the observed page.                                                     |
| W3C Verifiable Credential or signed organization attestation                                                         | Credential issued by the organization, public agency, professional body, or existing verified steward and presented through a supported verifier flow.                                                                                                       | Issuer asserted a role, employment, delegation, board service, membership, or authority claim about the holder/subject.                                   | Strong when issuer policy, holder binding, status, expiration, and claim mapping verify. Unknown issuers and high-risk claims require human review.                                    |

### Data Sources To Avoid For Legal Association Proof

Some sources can help discovery but should not prove legal association by
themselves:

- Contributor employer or occupation fields in campaign-finance records.
- Donor names, customer names, event attendee lists, petition signatures, or
  newsletter lists.
- Social follows, likes, reposts, endorsements, or profile bios.
- News mentions that say someone attended, supported, criticized, funded, or met
  with an organization.
- Shared address, phone number, domain registration, or coworking location.
- AI-inferred relationships.
- Scraped people-search data or brokered personal data.
- A current email-domain match when the claim is for a person, high-risk role,
  delegate authority, or legal authority beyond low-risk organization
  stewardship.

### Legal Association Claim Record

Atlas should store legal association evidence as scoped claims, not as a single
profile flag. A useful record includes:

- Association claim id.
- Person profile id.
- Organization profile id.
- Normalized association type.
- Source role label as written.
- Public display label.
- Jurisdiction.
- Filing agency or issuer.
- Filing type.
- Filing id, accession number, committee id, EIN, state entity id, CIK, UEI,
  union file number, LDA registration id, license number, or other external
  identifier.
- Filing period, tax year, term dates, effective date, expiration date, or event
  date.
- Source id and URL.
- Source observed timestamp.
- Extracted person name as written.
- Extracted organization name as written.
- Match confidence for person and organization resolution.
- Currentness state: current, historical, stale, expired, unknown, or disputed.
- Proof tier.
- Review state.
- Reviewer decision id when human review was required.
- Public-safe limitations summary.

### Legal Association Decision Rules

- Person-name matching alone is not enough for high-risk claims. Require
  corroborating identifiers, official context, organization confirmation, or
  human review.
- A government filing can prove that a person was listed in a role for a filing
  period. It does not prove that the role remains current unless the source is
  current and the role is not contradicted.
- Registered agent is a service-of-process role, not proof of leadership,
  employment, or policy authority.
- Board, officer, trustee, treasurer, and custodian roles are role-specific.
  They do not automatically imply day-to-day operational authority.
- Staff-page evidence can be more current than a Form 990, but it is still
  organization-controlled, not a government filing.
- Private proof can support stewardship and reviewer decisions, but public users
  should see a public-safe label and limitations rather than private documents.
- If two official sources conflict, route to human review and show the public
  state as disputed, stale, or under review.
- If the association would expose sensitive personal information, vulnerable
  networks, private addresses, minors, immigration status, health information,
  or safety-sensitive affiliations, route to safety review before public
  display.

### When Human Review Is Required

Human review should be mandatory for:

- Person profile claims.
- High-risk or high-visibility profiles.
- First steward on ambiguous public profiles.
- Delegate access.
- Competing or disputed claims.
- Revocation, reinstatement, and appeals.
- Source suppression or removal.
- Claims involving safety reports or restricted-use concerns.
- Claims that depend on private evidence.
- Credential presentations from unknown, low-assurance, or unsupported issuers.
- Conflicts between technical proof and public source evidence.
- Legal association claims that rely on name-only matching, court records,
  sensitive affiliations, conflicting filings, stale filings, or private proof.
- Bulk publication of people, sensitive affiliations, or vulnerable community
  networks.

### What Reviewers Decide

Reviewers decide whether the evidence is sufficient for the requested action:

- Approve a profile claim.
- Deny a profile claim.
- Request more information.
- Mark a claim disputed.
- Revoke stewardship.
- Resolve a correction.
- Suppress or restore a source.
- Escalate a safety issue.
- Approve a submitted source.
- Reject a restricted-use request.

### What Reviewers Do Not Certify

Reviewer approval does not mean:

- Every statement in every source is true.
- Every profile field is current.
- The subject endorses every source.
- Rebuilding America endorses the subject.
- A steward owns the public profile.
- The profile is safe for every downstream use.

### Reviewer Records

Each review event should record:

- Action type.
- Affected profile, claim, source, directory, domain, or workspace.
- Prior state and new state.
- Reviewer ID.
- Decision timestamp.
- Public-safe summary.
- Private reviewer note.
- Evidence considered.
- Risk or escalation category.
- Expiration or reconfirmation date, when applicable.
- Appeal or re-review eligibility.

## Layer 9: Corrections, Disputes, Suppression, And Restricted-Use Safety

### User Outcome

People can correct errors, contest harmful or misleading information, and trust
that Atlas will not become a tool for harassment, surveillance, or unsupported
claims.

### Components

- Public correction flow.
- Dispute and review states.
- Source suppression requests.
- Restricted-use intake and denial/escalation rules.
- Moderation queue.
- Reviewer actions and audit history.
- Public safety and methodology pages.
- API correction and flagging endpoints, where supported.

### Correction Types

- Wrong identity.
- Wrong role.
- Wrong location.
- Stale contact.
- Duplicate profile.
- Wrong relationship.
- Source problem.
- Missing context.
- Unsafe or overbroad exposure.
- Subject-provided update.

### Dispute States

Claims, sources, stewardship, or profile fields can be:

- Disputed.
- Under review.
- Corrected.
- Suppressed.
- Rejected.
- Restored.
- Revoked.

Public UI should visibly distinguish disputed and corrected states without
exposing private reporter information or reviewer-only safety context.

### Suppression Decision Factors

Reviewers should evaluate:

- Public interest.
- Safety risk.
- Relevance to the civic actor.
- Whether the source is already public and broadly accessible.
- Whether the source exposes private addresses, minors, vulnerable individuals,
  or sensitive affiliations.
- Whether the source is being used to harass, surveil, intimidate, or target.
- Whether a less destructive change can preserve public trust, such as hiding a
  field while keeping aggregate evidence state.

### Restricted Uses

Atlas should deny or escalate uses involving:

- Doxxing.
- Harassment.
- Intimidation.
- Law-enforcement surveillance.
- Private-person targeting.
- Bulk exposure of vulnerable organizers or communities.
- Unsupported allegations.
- Resale detached from provenance.
- Opposition research that strips context or safety.

Atlas can support:

- Public-source landscape intelligence.
- Local reporting.
- Coalition discovery.
- Civic directories.
- Public corrections.
- Subject stewardship.
- Safe monitoring of places, issues, organizations, and reviewed records.

### Safety Rule

If a use case depends on removing context, evidence, freshness, dispute state,
or safety limits, the use case is not compatible with Atlas.

## Layer 10: Federation, ATProto, W3C Verifiable Credentials, And Digital Credentials API

### User Outcome

Civic actors can carry portable identity and provenance into Atlas without
making users learn protocol details or weakening source-backed review.

### ATProto Role

ATProto is a federated identity, provenance, and source-candidate layer. It is
not Atlas's database and not a replacement for review.

ATProto can support:

- Linking an Atlas account to a stable DID.
- Showing a verified linked handle.
- Strengthening profile claims.
- Preserving source-submission provenance through AT URI, CID, author DID,
  collection, record key, and observation metadata.
- Supporting public civic contribution history.

ATProto cannot:

- Turn a post into a fact automatically.
- Override conflicting source evidence.
- Replace workspace authorization.
- Replace manual review for high-risk claims.
- Publish private workspace notes to the federated web.

### W3C Verifiable Credentials Role

W3C Verifiable Credentials should be a verifier-first proof path. Atlas should
accept signed credentials or presentations as evidence for scoped identity or
authority decisions; it should not become a broad credential issuer in the first
version.

Useful credential categories:

- Government or public-sector identity credential.
- Organization employment or affiliation credential.
- Nonprofit officer or board credential.
- Campaign, committee, or filing authority credential.
- Professional or institutional role credential.
- Delegation credential from an existing verified steward.

What a credential can prove:

- An issuer made a signed claim.
- The credential subject is bound to a holder or presentation.
- The credential was valid at a point in time.
- The credential has not been revoked, when revocation data is available.
- A specific attribute or relationship was asserted by a known issuer.

What a credential cannot prove alone:

- That Atlas should publish a profile fact.
- That the issuer is trustworthy for the requested decision.
- That the credential is current when status or expiration cannot be checked.
- That an organization role is still active beyond the credential's validity.
- That a subject consents to every source-backed claim.

### Digital Credentials API Role

The W3C Digital Credentials API should be treated as a browser-mediated
presentation channel. It can let a user consent to present a credential from a
wallet. It does not define Atlas's trust policy by itself.

Atlas should use it as progressive enhancement:

- Offer a wallet-based proof path where browser support exists.
- Fall back to upload/manual review or another verifier flow where unavailable.
- Request only the minimum claims needed for the specific decision.
- Avoid storing raw credentials unless there is a clear retention need.
- Store verification result metadata, issuer, credential type, subject binding,
  presentation timestamp, proof hash, status check result, and expiration.
- Route unsupported formats, unknown issuers, weak bindings, or conflicting
  claims to manual review.

### OpenID For Verifiable Presentations Role

OpenID for Verifiable Presentations can provide the verifier protocol for
requesting and receiving verifiable presentations from wallets. Atlas should
prefer standard presentation flows over custom credential upload for high-value
identity proof.

### Credential Review Policy

Credential proof can auto-support a claim only when all conditions are met:

- Issuer is trusted for the requested claim type.
- Credential format is supported.
- Signature or proof verifies.
- Holder binding verifies.
- Credential status and revocation checks pass when applicable.
- Credential is within validity dates.
- Presentation audience, nonce, and replay protections are correct.
- Requested attribute maps exactly to the Atlas decision.
- No conflict, dispute, duplicate risk, safety flag, or high-risk profile rule
  requires human review.

Otherwise the credential becomes evidence for review, not an automatic decision.

### Standards References

- [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [W3C Digital Credentials API](https://www.w3.org/TR/digital-credentials/)
- [OpenID for Verifiable Presentations 1.0](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)
- [AT Protocol DID specification](https://atproto.com/specs/did)
- [ATProto OAuth guide](https://atproto.com/guides/oauth)

## Layer 11: API, MCP, Exports, And Downstream Safety

### User Outcome

Developers and partners can reuse Atlas data without stripping away the trust
context that makes the data safe to interpret.

### Components

- Public API profile and source responses.
- Generated OpenAPI client types.
- MCP resources and tools.
- API key and OAuth access-token auth.
- Organization membership and capability checks.
- Usage events for integration activity.
- Correction and flagging endpoints where available.
- Documentation for sources, flags, workspace visibility, and endpoint safety.

### Rules

- API responses should preserve evidence metadata for fields that public UI uses
  for trust.
- New trust fields must be added to backend schemas, record builders, generated
  OpenAPI output, and frontend mapping together.
- Exports should not flatten away source IDs, source dates, freshness, dispute
  state, suppression state, or subject-provided markers.
- Private workspace artifacts require explicit visibility controls.
- API clients must not receive private reviewer notes, denied claimant
  identities, reporter identities, or private proof payloads.
- Programmatic access should be denied or escalated when the intended use strips
  context or matches restricted-use patterns.

## Current Implementation Snapshot

| Area                                        | Current state                                            | Notes                                                                                                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public trust guide                          | Implemented in Mintlify resources.                       | Explains evidence, stale data, corrections, limits, and public/private evidence boundaries.                                                                                              |
| Profile and evidence product contract       | Specified in PRD 02.                                     | Requires claim-level evidence, freshness, weak/disputed states, and mobile evidence inspection.                                                                                          |
| Profile claiming and stewardship            | Partially implemented and now fully specified in PRD 03. | API supports claim initiation with email-domain routing and manual evidence requirements; fuller lifecycle, proof records, reconfirmation, and review events remain implementation work. |
| Discovery publication gate                  | Implemented as conservative pure decision logic.         | People, duplicates, and uncorroborated web-only records hold for review.                                                                                                                 |
| Auth architecture                           | Implemented as split app/API auth architecture.          | App owns identity and sessions; API verifies JWT/API key/org membership.                                                                                                                 |
| Workspace SSO domain verification           | Implemented through Better Auth functions.               | Requests and verifies domain proof for SSO providers.                                                                                                                                    |
| Public directory custom domain verification | Implemented but weak.                                    | Current model compares submitted TXT text to stored token; should be upgraded to server-side DNS lookup.                                                                                 |
| Governance, corrections, and safety         | Specified in PRD 12.                                     | Needs implementation of queue, dispute states, suppression flow, restricted-use handling, and public safety surfaces where not already present.                                          |
| ATProto identity transition                 | Specified.                                               | Identity graph, DID linkage, ATProto proof, and federated source submissions are planned.                                                                                                |
| W3C VC and Digital Credentials API          | Not implemented; recommended path specified here.        | Start as verifier-only optional proof path for claims and reviewer workflows.                                                                                                            |

## Verification Matrix

| Decision                              | Automation can approve when                                                                                                                                       | Human review required when                                                                                                             | Public label                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Low-risk organization stewardship     | Verified email/domain/SSO proof matches the profile, no conflicts, no high-risk flags.                                                                            | Ambiguous relationship, competing claimant, safety flag, stale or conflicting sources.                                                 | Subject-stewarded.                                                                 |
| Person stewardship                    | Future low-risk proof path explicitly allows it and no risk flags exist.                                                                                          | Default path today; any public-person claim, conflicting source, delegate, high-risk profile.                                          | Subject-stewarded after approval.                                                  |
| Delegate access                       | Never by technical proof alone.                                                                                                                                   | Always, unless approved directly by an existing verified steward through a supported path.                                             | Stewarded, with delegate details private unless public-safe.                       |
| Organization profile auto-publication | Authoritative registry corroborates the org and dedup risk is clear.                                                                                              | No registry corroboration, possible duplicate, safety risk, or unclear actor type.                                                     | Source-linked or registry-corroborated.                                            |
| Person profile publication            | No current automatic path.                                                                                                                                        | Always before public publication.                                                                                                      | Source-linked, reviewed, or under review as appropriate.                           |
| Legal association claim               | Official source names the person, organization, role, filing context, and date; entity/person matching is high-confidence; role is low-risk and not contradicted. | Name-only matching, sensitive role, stale/conflicting source, private proof, court record, high-risk profile, or disputed association. | Scoped role label, such as listed director, listed treasurer, or approved steward. |
| Domain verification for SSO           | Better Auth domain verification succeeds.                                                                                                                         | Domain conflict, tenant mismatch, support escalation, suspicious setup.                                                                | Verified workspace domain.                                                         |
| Public directory custom domain        | Should be server-side DNS TXT verification.                                                                                                                       | Until fixed, any public trust claim based on directory domain verification should be treated carefully.                                | Verified directory domain only after DNS check.                                    |
| ATProto linked identity               | DID resolution succeeds, handle proof is current, and linkage maps to account or profile proof.                                                                   | Handle conflict, DID migration ambiguity, high-risk profile, claim conflict.                                                           | Verified linked handle.                                                            |
| W3C credential proof                  | Trusted issuer, supported credential, valid proof, holder binding, status check, exact claim mapping, no risk flags.                                              | Unknown issuer, unsupported format, weak binding, expired or unchecked status, profile risk, conflicting evidence.                     | Credential proof reviewed or verified proof.                                       |
| Source suppression                    | Never automatically for public trust changes.                                                                                                                     | Always reviewer decision.                                                                                                              | Suppressed or source limited, public-safe wording only.                            |
| Correction acceptance                 | Low-risk factual corrections may be queued for reviewer fast path.                                                                                                | Identity change, source removal, allegation, safety risk, contested subject, private proof.                                            | Corrected or under review.                                                         |

## Automation Boundaries

Automation can:

- Collect source candidates.
- Extract candidate facts.
- Score confidence.
- Detect possible duplicates.
- Route records to hold or publish paths.
- Match email or website domains.
- Verify cryptographic signatures and presentations.
- Check DNS records.
- Check revocation or credential status endpoints.
- Identify stale sources and reconfirmation windows.
- Pre-fill reviewer context.

Automation must not:

- Auto-publish person profiles.
- Auto-merge possible duplicates.
- Auto-verify high-risk profile claims.
- Treat credential existence as public truth.
- Decide source suppression.
- Resolve contested stewardship.
- Publish private proof.
- Infer endorsement, membership, or authority beyond the source.
- Remove evidence because a steward dislikes it.
- Strip provenance from downstream exports.

## Human Review Boundaries

Human reviewers should be equipped to:

- See all source evidence relevant to the decision.
- See current and historical stewardship state.
- See conflicts, duplicate candidates, safety flags, and correction history.
- Compare private proof with public evidence without exposing it publicly.
- Approve, deny, request more information, dispute, revoke, suppress, restore,
  or escalate.
- Write public-safe summaries and private notes separately.
- Set expiration or reconfirmation requirements.
- Trigger appeal or re-review workflows.

Human reviewers should not be asked to:

- Make broad truth guarantees.
- Decide based on hidden evidence alone when a public claim needs public trust.
- Resolve legal or interpersonal disputes outside Atlas's scope.
- Approve uses that depend on stripping source context.
- Convert unsafe private data into public evidence.

## What Atlas Must Never Claim

Atlas must not claim to:

- Verify every statement inside every source.
- Guarantee every profile is complete or current.
- Certify a person's real-world identity from email proof alone.
- Certify organizational authority from a domain match alone in high-risk cases.
- Collapse officer, employee, registered agent, lobbyist, donor, contractor,
  treasurer, board member, and steward into one generic "legal association"
  label.
- Treat workspace membership as public profile authority.
- Treat ATProto posts as facts.
- Treat W3C credentials as public truth without trust policy.
- Publish private workspace notes as public evidence.
- Replace local knowledge, direct verification, editorial judgment, or safety
  review.
- Endorse subjects, organizations, campaigns, initiatives, or sources by listing
  them.

## Audit And Data Retention

Trust decisions need durable records, but retention should be scoped to the
user-visible trust need and safety risk.

### Records To Keep

- Source records and source-profile links.
- Claim proof records.
- Legal association claim records with scoped role, source, date, jurisdiction,
  and limitations metadata.
- Credential verification metadata and proof hash.
- ATProto DID, handle, AT URI, CID, and observation metadata for accepted
  federated records.
- Domain verification token, method, status, and verification timestamp.
- Claim review events.
- Correction and dispute events.
- Suppression decisions.
- Reconfirmation timestamps.
- Stewardship status changes.
- API or integration usage events needed for abuse investigation.

### Records To Avoid Or Minimize

- Raw identity documents unless legally and operationally necessary.
- Raw credential payloads after verification when metadata is sufficient.
- Private reporter identity in public surfaces.
- Reviewer notes in API exports.
- Sensitive personal data that does not change the trust decision.
- Duplicated proof documents across claims when a hash and review record is
  sufficient.

## Operational Playbooks

### Low-Risk Organization Claim

1. Claimant signs in.
2. Claimant selects the organization profile.
3. Atlas checks verified email or eligible domain match.
4. Atlas checks conflicts, disputes, duplicate risk, safety flags, and profile
   type.
5. If clean, Atlas approves steward access or routes to fast review.
6. Public profile shows subject-stewarded state and preserves source-backed
   claims.
7. Reconfirmation is scheduled for 12 months.

### Person Claim

1. Claimant signs in.
2. Claimant submits claim and evidence.
3. Atlas collects proof path metadata.
4. Claim enters manual review.
5. Reviewer checks public sources, private proof, conflicts, safety context, and
   requested steward scope.
6. Reviewer approves, denies, requests more information, or marks disputed.
7. Public profile updates only after approval.
8. Reconfirmation is scheduled for 6 months.

### Source Suppression Request

1. Reporter identifies profile, source, field, and harm.
2. Atlas records reporter contact privately.
3. Source enters review without exposing reporter identity.
4. Reviewer evaluates public interest, safety, relevance, source quality, and
   restricted-use risk.
5. Reviewer suppresses, limits, restores, rejects, or escalates.
6. Public profile shows only public-safe state if context is needed for trust.

### Credential-Based Claim

1. Claimant chooses credential proof.
2. Browser or verifier flow requests the minimum required attributes.
3. Wallet presents a verifiable presentation.
4. Atlas verifies issuer, signature, holder binding, audience, nonce, validity,
   and status.
5. Atlas maps credential claims to the requested decision.
6. Clean low-risk organization claims can proceed if policy allows.
7. Person, high-risk, ambiguous, or conflicting claims enter review.
8. Atlas stores verification metadata and proof hash, not raw PII by default.

## Known Gaps And Product Work

1. Upgrade public directory custom-domain verification to server-side DNS TXT
   lookup.
2. Implement a general claim-proof model that supports email domain, manual,
   ATProto, domain, SSO-admin, delegate, and W3C credential proof.
3. Add reviewer-facing claim review events with public summaries and private
   notes.
4. Add reconfirmation jobs and stale-stewardship locks.
5. Add public-safe stewardship, dispute, stale, and subject-provided markers to
   profile API responses and frontend mapping where missing.
6. Implement moderation queue support for corrections, claims, sources,
   suppression, and restricted-use flags.
7. Add registry corroboration connectors before allowing organization
   auto-publication at scale.
8. Add identity graph foundation so email, passkey, SSO, ATProto, API key, and
   credential proofs are linked but not conflated.
9. Add Digital Credentials API and OpenID4VP verifier support as optional proof
   channels.
10. Define trusted issuer policy for credential proof.
11. Build official-source adapters for legal association evidence, starting with
    IRS Form 990, state business registries, FEC committee filings, OLMS union
    reports, LDA filings, and SEC EDGAR where the role context matters.
12. Add source and evidence preservation requirements to export and integration
    docs.
13. Add reviewer metrics: time to triage, time to resolution, dispute reversal
    rate, suppression outcomes, claim revocations, stale-stewardship counts, and
    correction-to-profile-view rate.

## Source Map

This system map consolidates and extends:

- [Experience First](../experience-first.md)
- [Product Docs README](./README.md)
- [UI/UX Architecture](./ui-ux-architecture.md)
- [Profile And Evidence PRD](./prds/02-profile-and-evidence-prd.md)
- [Profile Claiming And Stewardship PRD](./prds/03-profile-claiming-and-stewardship-prd.md)
- [ATProto Federated Web PRD](./prds/07-atproto-federated-web-prd.md)
- [Governance, Corrections, And Safety PRD](./prds/12-governance-corrections-safety-prd.md)
- [ATProto-Native Identity Transition](./atproto-native-identity-transition.md)
- [Auth Architecture](../auth-architecture.md)
- [Organization And Enterprise SSO](../architecture/organization-and-enterprise-sso.md)
- [Mintlify Trust Resource](../../mintlify/resources/trust.mdx)

## Final Product Standard

Atlas should feel trustworthy because the product makes proof visible, limits
obvious, and risky actions slow enough for judgment. A user should never need to
guess whether "verified" means account login, domain control, source evidence,
profile stewardship, credential proof, or reviewer approval. Each layer should
say exactly what it proves, preserve the evidence trail, and stop before it
claims more than it knows.
