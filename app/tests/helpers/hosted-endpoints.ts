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
  if (!trustedOidcToken) {
    return init;
  }

  const headers = new Headers(init.headers);
  headers.set("x-vercel-trusted-oidc-idp-token", trustedOidcToken);
  return { ...init, headers };
}
