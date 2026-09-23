# Atlas: product experience and launch decision

September 23, 2026 · Product, design, data, trust, organizational operations,
and billing

## The decision

**Atlas is not ready for broad national promotion or an unqualified paid launch.
A focused, useful launch before the midterms is achievable if the next six weeks
complete a few customer journeys and retire the current ambiguity about
evidence, ownership, and payments.** This is a recommendation, not a delivery
estimate backed by a staffed implementation plan.

The product has substantial foundations: public browsing, source links,
natural-language filtering, profiles, saved research, account and workspace
infrastructure, Stripe integration, and an editorial review system. The
immediate need is to make those pieces deliver an outcome that a person can
recognize. More features will increase the unfinished surface.

The launch promise should be concrete: **Find people and organizations working
on an issue in your community, understand their work through public sources, and
leave with a useful next step.** For paying researchers and organizers: **Turn
that search into a reusable, source-linked shortlist that helps you do real
work.** An organization pays for shared work and reliable administration. SSO is
an option inside that experience, not its introduction.

**On Stripe: I cannot certify that changing an API key is the only remaining
step.** There is historical proof that production opened a live Pro monthly
Checkout session, which means a key change may not even be necessary. There are
also concrete billing defects and missing lifecycle evidence. See the
[billing readiness audit](2026-09-23-billing-readiness.md).

## What this assessment actually verified

| Evidence                            | Scope and limits                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live production UI, September 22–23 | Home, browse, natural-language search, organization and person profiles, people directory, map, pricing, sign-in, sign-up, team entry, onboarding entry, profile verification entry, correction form; desktop and selected 390 × 844 mobile views. Thirteen screenshots are indexed below.                                                          |
| Live public API inventory           | All 1,403 unique records across 15 pages; aggregate field quality and selected detailed records. Counts describe stored data, not independent factual verification of every profile. [Aggregate evidence](assets/2026-09-22-launch/catalog-inventory.json).                                                                                         |
| Current source                      | GitHub main `58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a`, September 14. The supplied checkout is older, August 2 `7b804be5`. Current-main findings were rechecked in a read-only snapshot; they are not automatically proof that the identical code is deployed.                                                                                      |
| Release/provider metadata           | Relevant GitHub release, CI and canary runs; Vercel production variable names and GitHub checkout flag. No secret values copied into evidence.                                                                                                                                                                                                      |
| Docket                              | Rebuilding America launch audit, pricing, public marketing, trust/support, and first-user-cohort project descriptions and planning status. No projects edited or messages sent.                                                                                                                                                                     |
| Not verified                        | Normal signup completion, email delivery and account recovery, physical-device passkeys, private workspace screens in a signed-in runtime, a completed payment, live Stripe account eligibility/settings, webhook delivery, refunds, private moderation queues, actual support response times, field performance, or screen-reader task completion. |

No production account, report, claim, purchase, credential, or provider
configuration was created. No application fixes or deployments were made. This
is a comprehensive product assessment with explicit verification boundaries, not
an end-to-end release certification. A requested test-account clarification
remained unanswered; existing sessions did not provide authenticated Atlas
access. Stripe's available Atlas CLI credential was invalid, and its browser
required sign-in.

## Why shipping keeps getting blocked

Three loops are incomplete:

1. **Customer value:** a real question → useful results → understandable
   evidence → an appropriate action → a reason to return or pay. The UI exposes
   the catalog's machinery before consistently delivering this result.
2. **Editorial supply:** a defined user need → discovery → evidence review →
   publishable facts → useful search results → correction and refresh. Counts of
   records and jobs do not identify where useful supply is failing.
3. **Delivery ownership:** one accountable owner → a small outcome → observed
   acceptance → a supported release. Feature completion and infrastructure
   health have been used as proxies for customer readiness.

These are diagnoses of the observed product and planning evidence. They do not
establish a particular queue, worker, or staff member as the cause of production
data shortages; that requires operational funnel evidence.

## The three end-to-end experiences

| Person and job                                                            | Current friction                                                                                                                                                                  | Launch experience and acceptance                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public visitor: “Who works on housing near me, and can I trust this?”     | National promise; sparse people; search buried on mobile browse; registry filler and repeated evidence badges; topical similarity presented as a strong connection.               | Browse without an account. Search by place and issue immediately. Understand at least three relevant results in a promoted coverage area. Inspect the source for a claim and reach an official next step. No account wall for evidence or correction.                                            |
| Individual organizer/researcher: “Build a shortlist for work I am doing.” | Generic signup; action intent is not clearly carried through; saving failures can disappear; research forms request internal IDs.                                                 | Start with public value. Save a useful result, sign up when needed, and return to the exact pending action. Name a list, add a note, reopen it, and produce the promised export or brief. Pay only after the value and limits are understandable.                                                |
| Organization admin: “Help our small team work together.”                  | Team entry says “Set up SSO”; security/workspace/payment setup precedes a demonstrated shared outcome; administration is extensive; invitations and ownership transfer have gaps. | Explain the shared-work benefit and total seat price. Create a workspace, invite one colleague, give the right role, share a real list, and manage billing. Make public profile verification a separate, clearly related task. SSO configuration is optional unless the organization chooses it. |

**Public organization profile, verified representative, private workspace, and
billing customer are distinct concepts.** A person should know which they are
creating or administering. Claiming a public profile must not imply purchasing a
plan, editorial endorsement, or permission to overwrite sourced facts. Paying
must not buy factual credibility or removal of legitimate public criticism.

## Interface findings and design direction

### 1. Home and navigation: the mission is legible; the product is scattered

The warm palette and editorial headline are distinctive. Keep that identity. The
current home spends several large sections explaining Atlas before showing
useful examples, while the navigation gives Browse, Map, People, Organizations,
Pricing, Firehose, Docs, and API comparable weight. The compressed desktop
search and absent mobile global search make the primary task less prominent than
the feature inventory.

“Civic actors,” “source-linked local civic intelligence,” and “Atlas indexes”
sound like internal categories. Lead with what visitors can do. Keep the mission
statement, then show a real search and a small, editorially selected set of
useful records. Replace categorical national coverage language with accurate
coverage information. Presence in a state is not useful coverage of that state.

The home People and Organizations pills currently use `query=People` and
`query=Organizations`, while other tiles use structured type filters. These
should mean the same thing.
[Home discovery implementation](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/platform/pages/home-page-discovery.tsx#L79).

Recommended primary navigation: **Explore**, **Saved** when signed in, and a
contextual **Your organization** entry. Explore owns list/map and
people/organization filters. Put developer documentation and Firehose in
secondary navigation. Keep pricing and trust information discoverable without
giving every capability a top-level destination. This is an information
hierarchy change, not a requirement to delete functioning routes.

### 2. Browse: put the work before the promotion

At 390 × 844, the search box begins **2,056.5 pixels below the top**, after
eight large issue panels; its observed width is about 183 pixels. The first view
gives a visitor no practical way to search. On a search product, this is a
launch-blocking experience failure.
[Mobile screenshot](assets/2026-09-22-launch/07-browse-mobile.jpg).

Move search and place/issue controls to the beginning of the page. Show compact
suggested searches underneath, then results. Use removable filters and retain
URL-based state; those existing features work well. Clarify that issue-card
counts describe a preview if they do, rather than presenting “3 people and
groups” beside a catalog containing over a thousand housing-tagged records.

The live query **“housing in Detroit”** correctly resolved into Detroit and
housing filters and returned seven records. That is a useful foundation. The
first result, United Community Housing Coalition, had a meaningful summary. The
other six mostly used filing/EIN/classification prose. Natural-language search
cannot compensate for low-value results.

Each result should answer: **who, what work, where, and why this matches**. Show
a concise source/date line and a clear profile action. The current stack of
“Source-backed,” “source packet,” “Qualify before outreach,” “Local lead,”
“Recent source,” and “Limited source mix” consumes attention without making the
choice easier. Put detailed evidence diagnostics behind a disclosure. Never hide
a material uncertainty merely to simplify a card.

### 3. Profiles: make evidence useful, not ornamental

The United Community Housing Coalition page repeats substantially the same
description in the hero, “At a glance,” and “Why this matters.” It then stacks
quick facts, evidence, corrections, a quote, statistics, history, recent
activity, issues, presence, appearances, a large network, trust information, and
actions. The official website and useful next steps are too far down.
[Profile capture](assets/2026-09-22-launch/03-organization-profile.jpg) and
[full observed text](assets/2026-09-22-launch/03-organization-profile.txt).

Use this order: identity and current work → place/service area → official next
step and save → a short sourced explanation → specific evidence and dates →
documented relationships or clearly labeled related groups →
correction/verification. Remove repeated summaries and suppress empty
scaffolding. Use headings that answer a visitor's question.

Observed trust contradictions are substantive: the profile showed two sources
and corroboration, while its verification section said “Single source.” An IRS
filing description appeared as a “Signature quote from coverage.” “Last
confirmed” can derive from observation or ingestion rather than a person
confirming a fact. These require data and copy fixes together.

Separate **Sources** (what supports a fact), **identity verification** (who
controls this profile), **date of the fact**, and **review date**. A source
count is not a credibility score. An official primary source may be sufficient
for a specific claim; multiple copies of one publisher are not independent
corroboration.

The featured Max E. Carter II profile repeats the same large shell despite
limited issue/contact detail. A legislature record can be a legitimate directory
entry, but a handful of legislative profiles does not fulfill the broader
promise of finding local organizers. Editorially choose examples that
demonstrate the actual launch value.

### 4. Map: it works, but its mobile composition defeats its purpose

The map and approximately 1,397 continental points loaded. This corrects older
audit claims that the map was simply broken. The current mobile results panel
occupies most of the map: approximately x=12, y=155, width=365, height=607.
Controls and the count chip overlap near the top. The chip reports 180 places
while the results panel describes 541; those may count different things, but
that distinction is not explained.
[Mobile map](assets/2026-09-22-launch/08-map-mobile.jpg);
[panel layout source](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/domains/catalog/components/map/map-results-panel.tsx#L11).

Provide a clear List/Map switch with a shared query and selected result. On
mobile, use a collapsible results sheet or a dedicated results view. Reserve
space for the search, map controls, and selected-place information. Define the
meaning and scope of every count. Preserve the existing skip-to-results and
accessible control labels.

### 5. People directory: let people find people

The observed page shows “Profiles worth opening,” “People worth knowing,” and
“New in Atlas,” with repeated entries and large initials. It provides no obvious
route through all 48 people with useful filters. The opening sentence about
“public record, place, and issue” is abstract.

Use one searchable directory with role, issue, and place filters and a small
optional featured section. Show relevant work instead of repeating an initial
tile. Avoid wording that makes algorithmic inclusion sound like a moral
endorsement. Real photography can help when accurate and appropriately sourced;
generated portraits or invented testimonials cannot fix missing evidence.

### 6. Signup and recovery: finish the interrupted task

The split-screen auth composition is polished in isolation but gives substantial
space to a faint decorative map. Sign-in presents passkey and Continue paths
that need clearer user-facing distinction. The existing “Can't use a passkey”
route and preserved profile redirect are positive foundations.

Generic signup promises “Join Atlas”; team signup instead says “Set up SSO for
your team.” An independent organizer or neighborhood group should not have to
understand identity-provider administration to recognize that this is for them.
Start team signup with shared research. Separate optional enterprise setup from
the first useful shared task.

The paid onboarding entry correctly preserves selected product and interval and
shows Account, Security, Workspace, Payment. Required passkey setup is a
deliberate security choice, not by itself a defect. Its cost is a greater
obligation to prove cross-device setup, recovery, cancellation, and
return-to-task behavior on real devices. Existing virtual-authenticator Chromium
tests do not establish those outcomes.

Carry the intended action through authentication: not only “return to this
profile,” but “finish saving this profile to this list.” Explain verified
identity versus public display name. Verify address errors, expired codes,
interrupted registration, duplicate accounts, unsupported authenticators, and
sign-in from a second device. No live completion evidence was available for this
audit.

### 7. Organizer workbench: remove internal bookkeeping from the job

Current source shows a brief-creation form asking for **Linked actor IDs, Source
Receipt IDs, and Research Run IDs**. A paying organizer should select people,
sources, and earlier work from understandable choices, preferably from the list
they already built.
[Brief creation source](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/domains/workspace/pages/brief-create-page.tsx#L196).

A new workspace should offer one obvious next action: continue the search/list
that brought the person here. Show their recent saved work before infrastructure
or coverage dashboards. A useful empty state says what is absent and provides an
appropriate action; it should not explain discovery pipelines or pretend a
request failure is an empty collection.

The save-list picker has no clear mutation-error feedback, can represent fetch
failure as no lists, and uses an unlabeled input. Connections can similarly
render “none” when loading failed. Fix these seams before adding more research
outputs. Acceptance means a forced failure preserves the user's work, states the
failed action, and offers a retry.
[Save picker](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/domains/catalog/components/profiles/save-list-picker.tsx#L57).

### 8. Organization administration: design for a small group first

The source places extensive administration ahead of inviting a colleague. Put
workspace identity, teammates, and shared work first; move SSO/SCIM and
specialized configuration to clearly labeled settings. Keep terminology
consistent across organization, workspace, team, and billing.

Source-established issues needing signed-in acceptance:

- A failed invitation can clear its entered fields. Preserve the email and role
  until confirmed success.
- Removing/leaving a workspace executes directly; require a clear consequence
  review for losing access, with confirmation or undo where appropriate.
- The invitation page conflates expiry with other failures; its wrong-account
  path does not clearly switch accounts.
- Copy promises ownership transfer, but the reviewed UI has admin/member changes
  without a complete ownership handoff. Complete the transfer and last-owner
  protections, or remove the unsupported promise and provide a reliable
  supported procedure.
- The team table uses a minimum width of 42rem. A horizontally scrollable
  desktop table is a poor primary mobile administration experience; use readable
  member rows with contextual actions.

[Workspace handlers](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/domains/access/components/organization/use-organization-page-workspace-actions-handlers.ts#L183),
[invitation screen](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/domains/access/pages/auth/accept-invitation-page.tsx#L115),
[member controls](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/app/src/domains/access/components/organization/team-members-section.tsx#L49).

### 9. Claims and corrections: retain the low-friction entry, prove the private path

The live claim entry explains matching-email verification, review, and what is
public versus private. It preserves the return URL through sign-in. The live
correction form is available without an account, names the affected
organization, offers three clear categories, and makes contact email optional.
Preserve these strengths. No form was submitted.

The correction form should explain who sees the submission and what
acknowledgment the reporter receives. Only promise a response time the actual
operator can meet. Provide a distinct urgent route for exposed private contact
information or identity misrepresentation, with a defined operator response. A
report must not be the only way to protect someone if the inbox is unattended.

**P0 code finding:** anonymous entity/source flag listing returns
`FlagResponse.note`, populated from raw notes. This is a source-established
exposure path, not proof that sensitive reports currently exist or were
accessed. Separate public status/counts from private report evidence and contact
details. Verify with synthetic staging reports. Never test this by reading real
reporter notes.
[Moderation endpoint](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/api/atlas/domains/moderation/api.py#L77).

### 10. Style, accessibility, and performance

Keep the warm editorial character, recognizable typography, and restrained gold
accent. Reduce grid texture behind dense work, oversized headings on utility
pages, repeated bordered cards, and decorative initials that displace meaningful
information. Give working pages a calmer rhythm: consistent spacing, one primary
action, readable rows, and deliberate evidence disclosures. This is a design
recommendation, not a finding that all dark interfaces are inappropriate.

Use the light theme as a first-class outdoor/daylight experience and verify both
themes. Source review identified white text on pale source badges, an unlabeled
list input, selected state conveyed only visually, and dynamic passkey error
text without an explicit live announcement. The source-derived badge contrast
estimates are below normal text requirements; they are not a full rendered
accessibility audit. Test actual computed colors, focus, keyboard traversal,
zoom/reflow, touch targets, dialogs, and announcements against
[WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/).

No current Lighthouse or field-performance score is claimed. Set a release
budget and measure real routes, especially search, map, and profile. Proposed
field goals are the standard good thresholds at the 75th percentile: LCP ≤2.5s,
INP ≤200ms, CLS ≤0.1. Keep usable navigation and primary controls visible while
optional content loads.
[Core Web Vitals definitions](https://web.dev/articles/vitals).

## Data: define usefulness before collecting more

| Live inventory   | Observation                                                                                      | Product consequence                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Total            | 1,403 records: 1,355 organizations, 48 people                                                    | The “find people” promise is materially ahead of supply.                                                  |
| People geography | 45 Nevada; one each California, Colorado, Oklahoma                                               | National person discovery is particularly thin.                                                           |
| Sources          | 1,165 single-source; 235 multiple-source; 3 unsourced people                                     | Source count cannot stand in for reviewed, relevant facts. The unsourced public records need disposition. |
| Website field    | 1,040 absent                                                                                     | A website is missing in 74.1% of records; this does not prove no contact or next step exists elsewhere.   |
| Issue tags       | Housing affordability 1,028; transportation/mobility 218; public transit 117; electoral access 2 | Coverage is uneven. Tags overlap; these are not disjoint totals or a reason to add election features.     |
| Freshness labels | 1,355 fresh, 47 aging, 1 stale                                                                   | Stored freshness is largely not evidence that the underlying work is current.                             |

The home currently showcases a transit organization with a copyright notice as
its description. Another transit summary is an incomplete funding paragraph. The
Detroit result set illustrates the same problem at task level. **The acquisition
target should be useful, evidenced profiles per customer question, not rows per
pipeline run.**

Start with one place and one or two issues where you have credible local access
and prospective users. Las Vegas and a housing/transit slice are a plausible
candidate given the existing steward plan and network, not a decision proven by
market research. Review roughly 50–100 strong profiles as a capacity hypothesis;
start smaller if that is what the query benchmark needs. Keep wider records
available with honest limitations, while only promoting coverage that meets the
usefulness bar.

For each publishable profile, review identity, actual current work, relevant
issue, service geography, source dates, a safe public next step, duplicates, and
support for material claims. A registry proves a filing or role; it does not
automatically establish issue expertise, service coverage, willingness to
collaborate, or a person's moral character. A primary authoritative source is
sufficient for facts it actually supports; avoid arbitrary two-source
requirements that create bureaucracy without added confidence.

Three data-model behaviors need correction:

1. **Corroboration is inferred from count.** Current code can call any two
   sources corroboration and reuse every source across summary/place/issues.
   Live Bike Walk Nebraska has conflicting corroborated/unverified signals,
   empty claim source IDs, and two URL forms of its own website plus ProPublica.
   Canonicalize publishers and tie evidence to claims.
   [Trust helper](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/api/atlas/platform/mcp/data_trust_helpers.py#L84).
2. **Similarity is presented as relationship strength.** Shared issue/place
   points normalized against the best candidate can produce a “Strong” network
   tie without a documented relationship. Label these “Related groups” with an
   explicit reason, and reserve relationship language for evidence.
   [Connection scoring](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/api/atlas/domains/catalog/models/connections.py#L281).
3. **New-record gates do not fully protect subsequent edits.** Rediscovery can
   overwrite published description/contact fields; resolution can change a
   person before a hold retains their public status. Stage material changes and
   retain last approved facts until reviewed. The user benefit is protection
   against a correct profile silently becoming wrong.
   [Persistence path](https://github.com/RebuildingAmerica/atlas/blob/58e0e10a12c89f5d5a4dbd6a82e3ccecc783ba1a/api/atlas/domains/discovery/pipeline/runner_storage_persistence.py#L100).

The current registry-resolution lane is implemented and can automatically
publish qualifying filing-based people. An old-checkout conclusion that all
people are always held is false for current main. Preserve its deduplication,
source receipts, dated roles, and protected review decisions. Align
contradictory policy documents with the behavior you actually intend.

Instrument one daily funnel by place, issue, and source channel: discovered →
deduplicated → evidence sufficient → held with reason → reviewed → published →
returned in a successful user task. Show age and owner at each hold. This
distinguishes missing discovery from poor extraction, review backlog, failed
publication, or simply irrelevant coverage. Current queue sizes, failure causes,
and reviewer throughput were not accessible here.

## Money: release acceptance must include delivery and exit

Live pricing advertises Free, Pro at $5/month, Team at $25/month plus
$8 per additional seat, and nonrenewing Research Passes at $4/7 days and $9/30
days. Annual, student, journalist, and creator variations add combinations to
support. Existing disclosure of renewal and cancellation is a strength.

The page leads with how Atlas is funded and infrastructure costs. Lead with the
customer's outcome, then show the free/paid boundaries and total charge. Explain
Team's included seat and additional seats with a concrete price example. Keep
the funding explanation as supporting context. Do not add more plans before the
existing offers have acceptance evidence.

| Billing area                    | Assessment                                                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live Checkout creation          | Historical pass: September 14 Pro monthly live session. It stopped before payment and used a prepared account.                                                                                      |
| Production configuration        | Key/catalog/webhook-secret variable names are present. Correct account, catalog contents, secret match, current charge capability, and portal settings were not authenticated.                      |
| Workspace billing authorization | Fix required: portal session creation lacks the owner/admin guard used by purchase onboarding. A normal member must not receive the customer's billing portal URL.                                  |
| Settlement and entitlement      | Hosted purchase-to-access proof missing. Completion webhook grants active/paid without checking payment status; delayed-settlement risk is conditional on enabled methods.                          |
| Refund and cancellation promise | Cancellation, refund, pass expiry, renewals, seats, and returning paid access need provider-level acceptance. No demonstrated refund-to-revocation process was found.                               |
| Release/config documentation    | Current workflow preserves Vercel Stripe values; the runbook describes older overwrite behavior. Restricted-key instructions omit runtime operations. Fix the operating instructions with the code. |

The minimum paid acceptance is: select an offered plan → complete normal account
setup → correct Stripe charge/receipt → return to the correct workspace → gain
exactly the purchased capability → still have access after sign-out/sign-in →
manage or end the purchase as promised. Exercise webhook delay, retry,
duplicate/out-of-order delivery, declined payment, renewal failure, canceled
checkout, canceled subscription, pass expiry, seat changes, and refunds in a
controlled test environment. Then verify live configuration and observe a
genuine authorized purchase. Do not manufacture live test charges; Stripe
provides [testing environments](https://docs.stripe.com/testing).

Verify the correct live account and runtime key permissions, all offered live
price/coupon IDs, signed webhook delivery, required automatic-tax setup,
customer portal configuration, and the deployed checkout flag. These are
prerequisites beyond a key, **not a claim that each is absent**. Existing
objects should be inspected before provisioning replacements. Stripe's own
[go-live checklist](https://docs.stripe.com/get-started/checklist/go-live)
supports treating readiness as a complete integration.

Automate repeatable configuration verification in the repository and emit a
redacted readiness report. If account activation or a provider permission needs
a human, report that exact remaining step. Do not leave the normal release
dependent on remembered dashboard clicks. The detailed
[billing annex](2026-09-23-billing-readiness.md) identifies the source locations
and existing release evidence.

## Operating the launch with the organization you actually have

Docket already identifies the right work. The
[launch-readiness audit](https://clearthedocket.com/orgs/01KY1N9BZMM4FPRB6NSAD1BPM9/projects/01M1ZQ88VKG08RNZP7HAWW3JXY)
explicitly describes a one-person organization and questions a roadmap whose
approximately 140 milestones were marked done. The
[first-user cohort](https://clearthedocket.com/orgs/01KY1N9BZMM4FPRB6NSAD1BPM9/projects/01M1ZQ8AFRSRT1R2709EWJTG6V)
proposes local journalists/creators doing real research.
[Trust and support operations](https://clearthedocket.com/orgs/01KY1N9BZMM4FPRB6NSAD1BPM9/projects/01M1ZQ8A5PVE0XB6YMZJG7KV8Z)
correctly calls for response targets matched to available capacity.

In the inspected project views, those operating projects were planned, with no
visible target dates, completed evidence, or named owners for several areas.
This is not proof that nobody is doing the work elsewhere. It is proof that the
inspected system does not yet make launch accountability visible.

Use the existing audit project as the release decision record. Each launch item
needs an accountable person, customer outcome, severity, dependency, acceptance
demonstration, and evidence link. Distinguish **implemented**, **deployed**, and
**validated with users**. Reopen or qualify milestones that only have
implementation evidence; do not create another parallel wishlist.

One person can hold several roles, but each responsibility must be explicit:

| Role                  | Responsibility and evidence                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Product/release owner | Defines the supported audience and coverage, cuts scope, observes tasks, owns the go/no-go decision.       |
| Editor/data steward   | Reviews promoted profiles, owns correction disposition, maintains the query benchmark and freshness queue. |
| Engineer              | Fixes customer failures, proves permissions and billing, records deployed version, verifies rollback.      |
| Support/operator      | Owns the inbox, failed purchases, refunds, urgent privacy cases, and known account recovery steps.         |

Use one primary delivery item at a time plus a daily editorial/support lane.
Hold a short daily blocker/incident review, demonstrate working journeys twice
weekly, and review user observations and scope weekly. Publish support
availability honestly. A reasonable starting target is urgent privacy triage the
same staffed day and routine acknowledgment within two business days, **only if
staffed capacity supports it**. Name an escalation/backup or reduce coverage and
promotion; do not invent 24/7 support.

Recruit five to eight formative participants covering public visitors,
independent organizers/researchers, and at least two small-team admins. Use
their actual work. Ask them to find someone, explain why the evidence is
credible, take a next step, save/reopen work, and administer a teammate where
relevant. Observe without steering. These sessions identify failures; they are
not a statistically representative validation of America.

Measure useful-task completion, time to first useful profile, source
comprehension, successful next step, saved-work return, paid activation,
failed-payment recovery, and correction age. Do not store sensitive research
queries or private notes in analytics by default. Signups, indexed rows, and
revenue alone can hide a broken experience.

## A six-week path to a product worth launching

The 2026 general election is **November 3**. This schedule targets a controlled
release before it and a maintained service afterward; the product is a
civic-work directory, not a new election-administration system.
[FEC election information](https://www.fec.gov/introduction-campaign-finance/election-results-and-voting-information/).

This is a capacity-constrained proposal. If only 20–25 hours per week are
available, six weeks provide about 120–150 hours. Re-estimate after the first
acceptance demonstrations. The response to less capacity is a smaller launch,
not lower privacy, truthfulness, or payment standards.

| Window       | Deliverable                                                                                                                                                                                                       | Exit condition                                                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sep 23–27    | Confirm scope and release baseline; contain private-note exposure; repair team billing authorization; restore required release gates; establish Stripe account/config visibility; define ten real launch queries. | One owner and an evidence board; no unresolved critical privacy/authorization path in the release candidate; billing prerequisites individually classified.      |
| Sep 28–Oct 4 | Search-first mobile browse; compact useful cards; one coherent profile layout; accurate sources/dates/relationships; review initial coverage.                                                                     | Each promoted query finds useful reviewed results and an official next step. People can search in the first viewport and read a profile without repeated filler. |
| Oct 5–11     | Complete save → signup → return → reuse; invite → accept → shared work; verify paid lifecycle and supported plans.                                                                                                | Recorded success and failure paths on staging/production-like data; all new-sale offers meet the billing matrix or are temporarily unavailable.                  |
| Oct 12–18    | Observe the formative cohort doing real tasks; run correction, recovery, and refund drills; fix the most common failures.                                                                                         | Evidence of independent task completion; no unresolved critical issue; operators can support each promoted promise.                                              |
| Oct 19–25    | Release candidate; real mobile/passkey and accessibility acceptance; final content review; deployment/rollback proof.                                                                                             | Exact build and configuration pass the launch gates. Remaining limitations are explicit and acceptable for the defined cohort.                                   |
| Oct 26–Nov 2 | Controlled launch, daily triage, support coverage, narrow invitations and measured expansion.                                                                                                                     | Reliable customer outcomes over several days. No last-minute feature expansion.                                                                                  |
| Nov 3 onward | Maintain source freshness, fulfill paid promises, handle corrections, expand based on actual unmet questions.                                                                                                     | Returning use and customer work completed; expansion only where supply and support can keep up.                                                                  |

### The concrete work queue

These are proposed work packages, not tickets created or estimates guaranteed.
Size means relative effort: S about a day, M several days, L about a week or
more; lifecycle verification and external access can change these substantially.

| Priority           | Work package / accountable role                                              | Size      | Definition of done                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0                 | Keep report notes private / engineer                                         | S–M       | Synthetic anonymous report cannot be retrieved through public lists; authorized review still works; public status reveals no private evidence.                          |
| P0 for paid Team   | Enforce billing authority / engineer                                         | S         | Normal member denied at server; owner/admin allowed according to policy; cross-workspace attempts denied.                                                               |
| P0 for release     | Restore trustworthy release gates / release owner                            | S–M       | Secret-scanner failure resolved safely; required CI and hosted checks pass for exact candidate; no leaked values copied into tickets; rollback demonstrated.            |
| P0 for paid launch | Prove the purchase lifecycle / engineer + operator                           | L         | Correct catalog/account and every offered sale variation verified; paid access, returning access, seats, cancellation, renewal, expiry, refund/revocation demonstrated. |
| P1                 | Put mobile search and map controls in usable positions / designer + engineer | M         | Search at top at 390px, no map-control overlap, readable results and working List/Map switch with state retained.                                                       |
| P1                 | Rebuild result/profile hierarchy around useful facts / designer + editor     | M–L       | No repeated summary or registry “quote”; official next step visible; evidence explains claims; counts and labels agree.                                                 |
| P1                 | Make trust and update semantics truthful / editor + engineer                 | M–L       | No count-only corroboration, synthetic affiliation, or ingestion-as-confirmation; material edits protected.                                                             |
| P1                 | Publish a useful coverage slice / editor                                     | Ongoing   | Ten representative questions pass against reviewed profiles; promoted records have sources and safe next steps; weak public records triaged.                            |
| P1                 | Finish save/signup/research seams / engineer                                 | M         | Pending action survives authentication; failures preserve work and show retry; briefs use meaningful selectors.                                                         |
| P1 for Team        | Finish invitation and ownership seams / engineer                             | M         | New invite, wrong account, expired invite, failed invite, member removal, and owner departure have safe, understandable outcomes.                                       |
| P1                 | Establish actual support and editorial operation / operator                  | S + daily | Named inbox owner, availability, private-report handling, correction disposition, refund/revoke procedure, and escalation rehearsed.                                    |
| P1                 | Validate with real users and devices / product owner                         | M + fixes | Recorded task outcomes across all three personas; physical mobile auth, keyboard and screen-reader essentials pass.                                                     |

### Release gates that mean something

These are proposed acceptance criteria, not results already achieved:

- No open critical privacy, authorization, payment-delivery, or unsupported
  harmful-claim defect in the release candidate.
- Every promoted place/issue query has at least three useful reviewed actors
  with a working public next step; results explain actual work, not just
  registration status.
- Every promoted material claim has appropriate supporting evidence. Broader
  catalog samples are checked across source type, geography, entity type, and
  age; unsafe or unsourced records receive explicit disposition.
- Public visitors can find, assess, and use a result unaided. Organizer and
  admin participants can complete their full task; repeated failures are fixed
  and retested. Record counts and times rather than claiming significance from a
  tiny study.
- Every plan available for new purchase has passed the complete billing matrix.
  Public release and paid release have separate decisions; a failed money gate
  does not require hiding useful free browsing.
- Corrections, identity verification, account recovery, cancellation, and
  refunds have an accountable supported path with observed evidence.
- Required checks pass on the exact deployed candidate; major mobile layouts,
  accessible task paths, performance, monitoring, and rollback have current
  evidence.

Pause promotion if useful-result quality falls below the promised scope, a
private-report exposure remains open, the operator cannot handle urgent
corrections, or paid users cannot receive/manage what they bought. Preserve
existing customer access while containing the affected new-user path.

### Explicit cuts

Defer new federation/white-label expansion, broader CRM functionality,
additional enterprise identity capabilities, new billing packages, more AI entry
points, and Firehose expansion. Maintain commitments already made to existing
users. Do not make launch contingent on filling every state or completing every
roadmap track. Do not introduce automated “good person” scores or infer
affiliations from shared interests.

The proud launch is a smaller set of promises kept exceptionally well: a useful
discovery experience, honest evidence, a safe path to contribute or correct,
saved work worth returning to, and a purchase that reliably delivers what it
says.

## Evidence index

Screenshots are of the live public site, not redesign mockups. Dark theme was
observed; this does not establish the default theme for every visitor. The asset
directory retains the session's September 22 start date; observations continued
September 23.

| Capture                                                                         | Evidence                                            |
| ------------------------------------------------------------------------------- | --------------------------------------------------- |
| [01 Desktop browse](assets/2026-09-22-launch/01-browse-desktop.jpg)             | Issue panels and search hierarchy                   |
| [02 Detroit results](assets/2026-09-22-launch/02-search-results.jpg)            | Meaningful first result beside dense trust metadata |
| [03 Organization profile](assets/2026-09-22-launch/03-organization-profile.jpg) | Profile hierarchy; full text in adjacent `.txt`     |
| [04 Signup](assets/2026-09-22-launch/04-signup-desktop.jpg)                     | Public account entry                                |
| [05 Team signup](assets/2026-09-22-launch/05-team-signup.jpg)                   | SSO-led proposition                                 |
| [06 Pricing](assets/2026-09-22-launch/06-pricing-desktop.jpg)                   | Funding-first opening and plans                     |
| [07 Mobile browse](assets/2026-09-22-launch/07-browse-mobile.jpg)               | Search below eight large issue panels               |
| [08 Mobile map](assets/2026-09-22-launch/08-map-mobile.jpg)                     | Results panel and control overlap                   |
| [09 Mobile people directory](assets/2026-09-22-launch/09-people-mobile.jpg)     | Repeated editorial groupings                        |
| [10 Mobile person profile](assets/2026-09-22-launch/10-person-mobile.jpg)       | Sparse record in a large repeated shell             |
| [11 Claim entry](assets/2026-09-22-launch/11-claim-desktop.jpg)                 | Identity verification and sign-in return            |
| [12 Correction form](assets/2026-09-22-launch/12-correction-desktop.jpg)        | Anonymous correction entry, optional contact        |
| [13 Home](assets/2026-09-22-launch/13-home-desktop.jpg)                         | Brand, mission, navigation, and initial search      |

The UI review also used the current
[Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).
Financial conclusions rely on current source, provider metadata, and official
Stripe documentation; no successful charge is claimed. Detailed evidence:
[billing annex](2026-09-23-billing-readiness.md),
[catalog inventory](assets/2026-09-22-launch/catalog-inventory.json).
