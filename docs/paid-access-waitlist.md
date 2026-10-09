# Paid access waitlist

Public Atlas, profiles, browsing, and free accounts remain available. The
waitlist controls permission to buy a particular paid product. An invitation
never grants paid features; settled billing remains the authority for
entitlements.

## Configuration

Managed multi-user deployments must set `ATLAS_PAID_ACCESS_MODE` to `waitlist`
or `open`. The checked-in environment examples, bootstrap configuration and
deployment workflows select `waitlist`. Missing or invalid managed configuration
fails explicitly. Self-hosted instances have no managed waitlist.

Docker Compose passes the managed flags at build time so staff navigation
remains available independently of service queries. Rebuild the app when
changing those flags.

The application applies migration 9 automatically during auth initialization for
SQLite and PostgreSQL. No separate database command is required. Email uses the
existing capture or Resend configuration. Staff must have a verified email
listed in `ATLAS_OPERATOR_ALLOWED_EMAILS`, a passkey, and a ready account. Being
a customer workspace administrator does not grant staff access.

## Screens and journey

| Screen                      | What the person can do                                                                                                                                                                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pricing                     | Compare prices, browse public Atlas, create a free account, join a product waitlist, or return to an existing request. Existing paying customers can manage their plan.                                                                                                                 |
| `/waitlist`                 | Choose a product and email; optionally provide name, organization and intended use. A receipt offers email correction and a resend after one minute.                                                                                                                                    |
| Confirmation email and link | Open a scoped link, then explicitly confirm the email. Opening a link alone does not change the request. A matching verified account can also explicitly confirm from its private request. Confirmation of a withdrawn request does not rejoin it; rejoining remains a separate action. |
| Private request             | See the selected product and status, edit optional context, withdraw, or rejoin.                                                                                                                                                                                                        |
| Staff waitlist              | Search and filter requests, inspect context and activity, select up to 50 eligible confirmed applicants, review exact recipients, and send invitations.                                                                                                                                 |
| Invitation                  | Review plan benefits and full billing charges, select an interval, then sign in or create an account. Continue through account security and workspace selection to review the payment commitment before checkout.                                                                       |
| Staff request detail        | Open keyboard-accessible request details without leaving the queue. Retry a failed detail load, inspect email outcomes, resend invitations, retry recent failed sends, or confirm withdrawal of an invitation.                                                                          |
| Expired link                | Request a fresh email link. Temporary load failures offer a retry without claiming the link expired.                                                                                                                                                                                    |

Permission is specific to an email and product and remains valid until withdrawn
or revoked. It applies across workspaces the person may manage. Choosing another
billing interval for that product needs no new approval. Another product
requires its own request. Existing paid products, renewals, billing portals, and
team membership continue through their existing paths.

Invitation pages use the full page surface and left-aligned context. On desktop,
plan benefits and payment choices occupy separate columns; on mobile, the
choices follow a concise plan introduction, with detailed benefits in a native
“What’s included” disclosure below the choices. This keeps the payment decision
close to the invitation without removing plan context. Continue sits at the
bottom, grouped with renewal terms and the next step. Native radio choices show
the full charge and billing period side by side. Student pricing and API
integrations use optional disclosures. Invitees can compare prices before
creating an account, and the selected interval survives sign-in. A payment
summary explains renewal, cancellation and tax before continuing and again
before checkout, so the person knows the commitment before paying. Fields share
the UI package's comfortable density, native validation, inset labels, and
high-contrast civic focus ring. Buttons and navigation actions share Button
styles. Editorial titles use the shared type scale. Native radio labels share
selected, hover and pressed states, with keyboard focus around the whole hit
target. The global focus fallback respects controls that delegate focus to a
parent. Disclosures use full-width bordered rows with a trailing chevron that
indicates expanded or collapsed state, plus shared focus and hover styles.
Navigation targets are at least 44 pixels, and mobile actions allow for the
bottom safe area. Renewal terms have greater prominence than the secondary tax
note.

Confirmation, withdrawal and rejoining focus the resulting heading so keyboard
and screen reader users can follow the change. Ordinary refreshes preserve
focus. SQLite waitlist transactions run synchronously on the shared auth
connection; rejected requests cannot roll back a sign-in or billing write that
runs afterward. PostgreSQL retains transaction isolation and row locking.

## Inviting and recovery

Open **Admin → Waitlist**. Only confirmed waiting requests with at least one
currently purchasable offer are eligible. Batches use ten bounded workers and
provider pacing; the Vercel function budget is 180 seconds to accommodate slow
email outcomes. Review recipients before sending. Global sales pauses, offer
restrictions and catalog readiness still apply. A pause blocks invitations and
checkout but leaves waitlist signup available.

`sent` means the email provider accepted the message. It does not mean delivered
to an inbox. `failed` means rejection; `unresolved` means acceptance could not
be established. A failed invitation email leaves purchase permission in place.
Staff can retry the same immutable encrypted message with its stable idempotency
key. An explicit resend creates a fresh link and message. An uncertain attempt
remains unresolved if a later retry is rejected. Retries stop after 23 hours,
before Resend's 24-hour idempotency retention ends; use **Resend invitation**
after that. Staff actions retain actor attribution in the activity history.

Links expire after seven days independently of purchase permission. Only link
digests are stored in the link table. Queued message payloads are encrypted with
a key derived from `ATLAS_AUTH_INTERNAL_SECRET`; secret rotation requires fresh
resends for old encrypted payloads. Private routes are uncached, unindexed, use
no referrer, and are excluded from analytics. Capture-mode logs omit waitlist
links.

Revocation blocks new checkout attempts. It does not cancel paid access or
prevent settlement of an already authorized Stripe session. A recorded purchase
is historical signup completion, not a claim that a subscription remains active.

## Verification

Run `pnpm --filter @rebuildingamerica/atlas-app test` for the unit suite and
coverage gate. Run
`pnpm --filter @rebuildingamerica/atlas-app run test:acceptance:waitlist` for
browser signup, captured confirmation, staff invitation, account and workspace
onboarding, revocation, mobile accessibility and expired-link recovery. The
browser suite uses local captured mail and the test catalog; live provider
delivery and Stripe test settlement are separate acceptance checks.

The database suite can additionally target an isolated PostgreSQL database with
`ATLAS_WAITLIST_TEST_POSTGRES_URL`. Never point it at a production database.
