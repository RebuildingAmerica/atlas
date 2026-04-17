# Email Domain Setup

[Docs](../README.md) > [Deployment](./README.md) > Email Domain Setup

This guide is for platform operators who need Atlas email to send from a
verified Resend domain.

Atlas should send auth and transactional email from a dedicated subdomain, not
from the root domain. Use a pattern like:

- root domain: `example.com`
- sending subdomain: `atlas-mail.example.com`
- sender address: `Atlas <noreply@atlas-mail.example.com>`

Replace `example.com` with your real domain everywhere below.

Do not cut production traffic over to Resend until the sending domain is
verified and a real message has been received successfully.

## Before You Start

Confirm these three things first:

1. You have access to the production Resend account.
2. You have permission to edit DNS for your root domain.
3. You know whether the Atlas mail subdomain is delegated to its own DNS zone.

Most teams will publish these records in the main root-domain zone. Use a
separate zone only if the subdomain is already delegated elsewhere.

## Step 1: Choose The Sending Subdomain

Pick one dedicated subdomain for Atlas transactional email. Recommended:

- `atlas-mail.example.com`

Keep marketing or bulk mail off this subdomain so Atlas auth mail has its own
reputation.

## Step 2: Add The Domain In Resend

1. Sign in to the Resend dashboard.
2. Open `Domains`.
3. Click `Add domain`.
4. Enter your Atlas sending subdomain, such as `atlas-mail.example.com`.
5. Submit the form.
6. Leave the Resend tab open.

Resend will now show the exact DNS records required for your account. Use the
record names and values from that screen exactly as shown.

## Step 3: Publish The DNS Records

Open your DNS provider and edit the zone that serves your root domain, unless
the mail subdomain is delegated elsewhere.

Create every record Resend shows. At minimum, expect:

- one SPF `TXT` record
- one DKIM `TXT` record
- one MX record for the Resend return-path host

Operator rules:

- Copy the `Name`, `Type`, and `Value` fields exactly from Resend.
- If your DNS provider has a proxy toggle, set these records to DNS-only.
- Do not reuse old mail records from another service.
- Do not replace Resend’s values with examples from this document.

If your DNS provider rewrites MX targets, use the fully qualified target Resend
shows. If the provider supports a trailing `.`, keep it when Resend shows one.

## Step 4: Add DMARC For The Sending Subdomain

If you do not already manage DMARC for your Atlas mail subdomain, add a monitor
mode record like this:

```dns
_dmarc.atlas-mail.example.com. TXT "v=DMARC1; p=none; rua=mailto:dmarc@example.com;"
```

This starts DMARC in monitor mode. Move to `quarantine` or `reject` later only
after confirming good delivery.

## Step 5: Confirm DNS Is Public

Before clicking verify in Resend, confirm that the records are visible from the
public internet.

Run:

```bash
dig +short TXT atlas-mail.example.com
dig +short TXT resend._domainkey.atlas-mail.example.com
dig +short MX send.atlas-mail.example.com
dig +short TXT _dmarc.atlas-mail.example.com
```

If your actual DKIM or MX hostnames differ, use the exact Resend-provided
names.

If `dig` is not installed, run:

```bash
nslookup -type=TXT atlas-mail.example.com
nslookup -type=TXT resend._domainkey.atlas-mail.example.com
nslookup -type=MX send.atlas-mail.example.com
nslookup -type=TXT _dmarc.atlas-mail.example.com
```

Do not continue until the public lookup returns the records you just created.

## Step 6: Verify The Domain In Resend

1. Go back to Resend.
2. Open the sending-domain page you just created.
3. Click `Verify DNS records`.
4. Refresh until the domain shows `Verified`.
5. Confirm SPF and DKIM both show as passing in Resend.

Once the domain is verified, Resend can send from any mailbox at that
subdomain.

## Step 7: Configure Atlas Production

Set these production environment variables for the app:

```env
ATLAS_EMAIL_PROVIDER=resend
ATLAS_EMAIL_FROM=Atlas <noreply@atlas-mail.example.com>
ATLAS_EMAIL_RESEND_API_KEY=<your resend api key>
```

Atlas production should send directly through the Resend API. Do not configure
SMTP for production Atlas.

## Step 8: Smoke Test Real Delivery

1. Deploy the app with the production email environment variables.
2. Open the Atlas sign-in page.
3. Request a magic link for a mailbox you control.
4. Confirm the message arrives.
5. Open the message details in your mail client.
6. Confirm the `From` header uses your Atlas mail subdomain.
7. Confirm SPF or DKIM passes in the message details.

## Verification Checklist

Before declaring email ready, confirm all of these:

- Resend shows your Atlas mail subdomain as verified.
- Public DNS lookups return the SPF, DKIM, MX, and DMARC records.
- Atlas production uses `ATLAS_EMAIL_PROVIDER=resend`.
- Atlas production uses an `ATLAS_EMAIL_FROM` mailbox on the verified
  subdomain.
- A real magic-link email arrives in a mailbox you control.
- The delivered message passes provider authentication checks.

## Troubleshooting

If the domain does not verify:

- confirm the records were added in the correct DNS zone
- confirm the names and values exactly match Resend
- confirm the records are DNS-only, not proxied
- wait for propagation and rerun `dig` or `nslookup`
- retry verification only after the records are visible publicly

If mail sends but inbox placement is poor:

- confirm DMARC is published
- keep Atlas transactional mail isolated on its own sending subdomain
- do not mix bulk or marketing mail onto the same subdomain

## Operator References

- https://resend.com/docs/dashboard/domains/introduction
- https://resend.com/docs/dashboard/domains/dmarc
- https://resend.com/docs/knowledge-base/is-it-better-to-send-emails-from-a-subdomain-or-the-root-domain
- https://resend.com/docs/knowledge-base/how-do-I-create-an-email-address-or-sender-in-resend
- https://resend.com/docs/knowledge-base/what-if-my-domain-is-not-verifying
