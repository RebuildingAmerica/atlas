export function requiredHostedOrigin(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return new URL(value).origin;
}

export function absoluteHostedUrl(origin: string, pathname: string): string {
  return new URL(pathname, origin).toString();
}

export function hostedPublicRequestInit(init: RequestInit = {}): RequestInit {
  const trustedOidcToken = process.env.ATLAS_HOSTED_VERCEL_TRUSTED_OIDC_TOKEN?.trim();
  const bypassSecret =
    process.env.ATLAS_HOSTED_VERCEL_BYPASS_SECRET?.trim() ||
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (!trustedOidcToken && !bypassSecret) {
    return init;
  }

  const headers = new Headers(init.headers);
  if (trustedOidcToken) {
    headers.set("x-vercel-trusted-oidc-idp-token", trustedOidcToken);
  }
  if (bypassSecret) {
    headers.set("x-vercel-protection-bypass", bypassSecret);
  }
  return { ...init, headers };
}
