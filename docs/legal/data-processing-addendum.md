# Data Processing Addendum (template)

Status: Unreviewed draft. No lawyer has read this. Owner: Rebuilding America
Project Last updated: 2026-09-10

## Who this is for

You are answering an enterprise buyer who asked for a DPA before signing. Fill
the four bracketed fields in Section 1, send it, and record what you sent. Get
counsel to review it before the first signature, because Atlas publishes
information about people who never agreed to anything and that makes this
sharper than a normal SaaS DPA.

## What this document decides

It commits Atlas to processing customer personal data only on the customer's
instructions, names every subprocessor, and sets a 72-hour breach notice. It
deliberately does **not** treat the public directory as customer data. That
boundary is the one term a buyer is most likely to push on, and Section 3
explains why we hold it.

We chose a single addendum covering GDPR, UK GDPR, and the US state laws rather
than separate annexes per regime. A three-annex document is more precise and
nobody at either end would keep it current. If a buyer's counsel requires the EU
Standard Contractual Clauses as a separate signed instrument, attach the current
SCCs and say so in Section 9 instead of restating them here.

---

## 1. Parties and scope

This Data Processing Addendum ("DPA") supplements the agreement between
**Rebuilding America Project** ("Atlas", "Processor") and **[CUSTOMER LEGAL
NAME]** ("Customer", "Controller"), effective **[DATE]**, covering Customer's
use of **[Atlas Pro / Atlas Team / named contract]**.

Governing law and venue: **[STATE]**, consistent with the underlying agreement.

Where terms are defined in the underlying agreement, those definitions apply.
"Personal Data", "Controller", "Processor", "Processing", and "Data Subject"
carry the meanings given in Regulation (EU) 2016/679 (GDPR), and the equivalent
terms in the UK GDPR and the California Consumer Privacy Act as amended
(CCPA/CPRA) map onto them.

## 2. Roles

Customer is the Controller of Customer Personal Data. Atlas is the Processor,
and processes that data only on Customer's documented instructions.

Under the CCPA, Atlas acts as a Service Provider. Atlas does not sell or share
Customer Personal Data, does not retain, use, or disclose it for any purpose
other than performing the services, and does not combine it with personal
information from another source except as permitted for a Service Provider.

## 3. What is and is not Customer Personal Data

**Customer Personal Data** is the data Customer's people put into Atlas or that
Atlas creates about them in the course of the service:

- Account records: name, email address, authentication credentials, passkey
  metadata, SSO and SCIM attributes supplied by Customer's identity provider.
- Workspace content: lists, notes, briefs, watchlists, saved searches,
  annotations, and coverage requests.
- Operational records: request logs, API key usage, audit events, and billing
  and subscription records.

**Public directory records are not Customer Personal Data.** Atlas compiles
information about civic actors from public sources and publishes it as a public
directory. Atlas is the Controller of those records, not the Processor, and
Customer's instructions do not govern them. A Customer cannot direct Atlas to
publish, alter, suppress, or delete a directory record about a third party.

We hold this line because the alternative makes Atlas a private data broker
acting on a paying customer's instructions about non-consenting individuals. The
removal and correction process for people described in the directory is
published in the Privacy Policy at https://atlas.rebuildingus.org/privacy and
applies to everyone equally.

What would change our mind: a Customer whose own employees appear in the
directory may ask for those specific records under the published process, on the
same terms as anyone else.

## 4. Instructions

Atlas processes Customer Personal Data to provide, secure, support, and bill for
the services, and for no other purpose. The underlying agreement, this DPA, and
Customer's use of the product's own controls together constitute Customer's
documented instructions.

Atlas tells Customer if an instruction appears to violate applicable data
protection law, and may suspend the instruction until it is resolved.

## 5. Confidentiality and personnel

Atlas limits access to Customer Personal Data to personnel who need it to
deliver or support the service, and binds them to confidentiality that survives
the end of their engagement.

## 6. Security

Atlas encrypts Customer Personal Data in transit and at rest, scopes API keys to
the permissions they need, supports passkey authentication so an account need
not depend on a password, and supports SAML/OIDC single sign-on and SCIM
provisioning for Atlas Team workspaces.

Atlas holds no third-party security certification today. Do not claim SOC 2, ISO
27001, or any other attestation in response to a questionnaire. Say that none
exists.

## 7. Subprocessors

Customer authorises the subprocessors below. Each is bound by written terms no
less protective than this DPA, and Atlas remains liable for their performance.

| Subprocessor | Purpose                                                                              | Location            |
| ------------ | ------------------------------------------------------------------------------------ | ------------------- |
| Vercel       | Application hosting and server-side rendering                                        | United States       |
| Google Cloud | API compute and identity server                                                      | United States       |
| Neon         | PostgreSQL database for accounts, workspaces, and directory records                  | United States       |
| Cloudflare   | Traffic routing and protection                                                       | Global edge network |
| Stripe       | Payments, subscriptions, and tax calculation                                         | United States       |
| Resend       | Sign-in links, invitations, and account email                                        | United States       |
| Anthropic    | Extraction of structured records from public web pages; no account data is sent      | United States       |
| Brave Search | Discovery search queries describing places and civic topics; no account data is sent | United States       |

The current list also appears at https://atlas.rebuildingus.org/privacy. Atlas
gives Customer 30 days' notice before adding or replacing a subprocessor.
Customer may object in writing within that period on reasonable data protection
grounds, and if the parties cannot resolve the objection Customer may terminate
the affected service and receive a pro-rata refund of prepaid fees.

## 8. Data subject requests

Atlas assists Customer in responding to requests to access, correct, delete,
restrict, or port Customer Personal Data, taking into account the nature of the
processing. Atlas responds to Customer's assistance request within 10 business
days.

Where a Data Subject contacts Atlas directly about Customer Personal Data, Atlas
refers them to Customer rather than acting on the request, unless required by
law to act.

Requests about public directory records follow the published process in the
Privacy Policy and are handled by Atlas as Controller.

## 9. International transfers

Atlas processes Customer Personal Data in the United States. Where Customer
transfers Personal Data subject to GDPR or UK GDPR, the parties incorporate the
European Commission's Standard Contractual Clauses (Decision 2021/914), Module
Two (Controller to Processor), with the UK International Data Transfer Addendum
where the UK GDPR applies.

For those Clauses: Clause 7 (docking) applies; Clause 9 option 2 (general
written authorisation) applies with the 30-day notice period in Section 7;
Clause 11 offers no independent dispute resolution body; Clause 17 selects the
law of Ireland; Clause 18(b) selects the courts of Ireland. Annex I is populated
by Sections 1 and 3 of this DPA, Annex II by Section 6, and Annex III by
Section 7.

## 10. Personal data breach

Atlas notifies Customer without undue delay and in any case within **72 hours**
of becoming aware of a Personal Data Breach affecting Customer Personal Data.
The notice describes the nature of the breach, the categories and approximate
number of Data Subjects and records affected, the likely consequences, and the
measures taken or proposed.

Notice is not an admission of fault or liability.

## 11. Audit

Atlas makes available the information necessary to demonstrate compliance with
this DPA and, on reasonable written notice and no more than once per twelve
months, allows Customer or an independent auditor bound by confidentiality to
audit that compliance. Customer bears the cost unless the audit uncovers
material non-compliance.

## 12. Deletion and return

On termination, Atlas deletes Customer Personal Data within **30 days**, except
where retention is required by law. Billing and tax records are retained for
seven years because tax law requires it. Security and request logs are retained
for 90 days.

Customer may export workspace content through the product before termination.

## 13. Liability and precedence

Each party's liability under this DPA is subject to the limitations in the
underlying agreement. Where this DPA conflicts with the underlying agreement on
the processing of Personal Data, this DPA prevails.

---

## What is still open

Four things a buyer may ask for that Atlas cannot supply today:

- No SOC 2, ISO 27001, or equivalent attestation exists. Say so plainly.
- No cyber liability insurance certificate.
- No formal penetration test report.
- No named Data Protection Officer or EU representative. Appoint one before
  selling into the EU.
