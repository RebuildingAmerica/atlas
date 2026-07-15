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

export function absoluteHostedUrl(origin: string, pathname: string): string {
  return new URL(pathname, origin).toString();
}

export function hostedPublicRequestInit(init: RequestInit = {}): RequestInit {
  const bypassSecret = process.env.ATLAS_HOSTED_VERCEL_BYPASS_SECRET?.trim();
  const trustedOidcToken = process.env.ATLAS_HOSTED_VERCEL_TRUSTED_OIDC_TOKEN?.trim();
  if (!bypassSecret && !trustedOidcToken) {
    return init;
  }

  const headers = new Headers(init.headers);
  if (bypassSecret) {
    headers.set("x-vercel-protection-bypass", bypassSecret);
  }
  if (trustedOidcToken) {
    headers.set("x-vercel-trusted-oidc-idp-token", trustedOidcToken);
  }
  return { ...init, headers };
}
