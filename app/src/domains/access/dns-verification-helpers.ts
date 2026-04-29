/**
 * Returns the relative TXT host (the leading subdomain Atlas asks the
 * admin to publish) and the full FQDN, given the host string Better Auth
 * returns and the workspace's email domain.  Both forms are surfaced on
 * the verification card so admins running DNS at the apex can paste the
 * relative form and admins managing zones from a parent provider can
 * copy the full FQDN.
 *
 * @param verificationHost - Either a relative `_better-auth-token-…`
 *   host or the fully-qualified equivalent already including the
 *   workspace domain.
 * @param workspaceDomain - The verified-domain value stored on the
 *   provider.
 */
export function splitVerificationHost(
  verificationHost: string,
  workspaceDomain: string,
): { fqdn: string; relative: string } {
  const trimmedHost = verificationHost.trim();
  const trimmedDomain = workspaceDomain.trim().toLowerCase();
  if (!trimmedHost) {
    return { fqdn: "", relative: "" };
  }
  const lowered = trimmedHost.toLowerCase();
  if (trimmedDomain && lowered.endsWith(`.${trimmedDomain}`)) {
    return {
      fqdn: trimmedHost,
      relative: trimmedHost.slice(0, trimmedHost.length - trimmedDomain.length - 1),
    };
  }
  if (trimmedDomain && lowered === trimmedDomain) {
    return { fqdn: trimmedHost, relative: "@" };
  }
  return {
    fqdn: trimmedDomain ? `${trimmedHost}.${trimmedDomain}` : trimmedHost,
    relative: trimmedHost,
  };
}

interface DnsProviderGuide {
  body: string;
  id: string;
  name: string;
}

/**
 * Per-DNS-provider snippets so admins running Cloudflare / Route 53 /
 * GoDaddy / Cloud DNS see the dialog-specific instructions next to the
 * generic "publish a TXT record" copy.  Stored statically because the
 * hostnames each console expects are stable enough to bake in.
 */
export const DNS_PROVIDER_GUIDES: readonly DnsProviderGuide[] = [
  {
    id: "cloudflare",
    name: "Cloudflare",
    body: "Open the DNS tab for the domain, click Add record, set Type to TXT, paste the relative host into Name, and the token into Content. Leave TTL on Auto.",
  },
  {
    id: "route53",
    name: "AWS Route 53",
    body: "Open the hosted zone for the domain, click Create record, set Record type to TXT, paste the FQDN into Record name (Route 53 expects fully-qualified names), and the token into Value (with quotes around it).",
  },
  {
    id: "google-domains",
    name: "Google Cloud DNS",
    body: "Open the zone for the domain, click Add record set, set Resource record type to TXT, paste the FQDN into DNS name, and the token into TXT data.",
  },
  {
    id: "godaddy",
    name: "GoDaddy / Namecheap",
    body: "Open Domain Manager → DNS Records, add a new record with Type=TXT, paste the relative host into Host, and the token into TXT Value.",
  },
] as const;
