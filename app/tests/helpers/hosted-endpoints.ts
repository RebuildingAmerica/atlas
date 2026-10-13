export function requiredHostedOrigin(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return new URL(value).origin;
}

export function optionalHostedOrigin(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? new URL(value).origin : null;
}

export function expectedHostedPublicOrigin(): string {
  return (
    optionalHostedOrigin("ATLAS_HOSTED_EXPECTED_PUBLIC_URL") ??
    requiredHostedOrigin("ATLAS_HOSTED_PUBLIC_URL")
  );
}

export function absoluteHostedUrl(origin: string, pathname: string): string {
  return new URL(pathname, origin).toString();
}

export function hostedPublicRequestInit(init: RequestInit = {}): RequestInit {
  const clientId = process.env.ATLAS_HOSTED_CF_ACCESS_CLIENT_ID?.trim();
  const clientSecret = process.env.ATLAS_HOSTED_CF_ACCESS_CLIENT_SECRET?.trim();
  if (Boolean(clientId) !== Boolean(clientSecret))
    throw new Error("Cloudflare Access client ID and secret must be supplied together.");
  if (clientId && init.redirect === "follow")
    throw new Error("Cloudflare Access requests must not automatically follow redirects.");
  if (!clientId) {
    return init;
  }

  const headers = new Headers(init.headers);
  if (clientId && clientSecret) {
    headers.set("cf-access-client-id", clientId);
    headers.set("cf-access-client-secret", clientSecret);
  }
  return { ...init, ...(clientId ? { redirect: "manual" as const } : {}), headers };
}
