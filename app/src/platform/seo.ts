const DEFAULT_PUBLIC_ORIGIN = "https://atlas.rebuildingamerica.com";

interface SeoEnv {
  ATLAS_PUBLIC_URL?: string;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function configuredPublicOrigin(env: SeoEnv): string | null {
  const publicUrl = env.ATLAS_PUBLIC_URL?.trim();
  if (!publicUrl) {
    return null;
  }

  const url = new URL(publicUrl);
  return url.origin;
}

export function buildCanonicalUrl(path: string, env: SeoEnv = import.meta.env): string {
  const origin = configuredPublicOrigin(env) ?? DEFAULT_PUBLIC_ORIGIN;
  const normalizedPath = trimSlashes(path);
  if (!normalizedPath) {
    return origin;
  }

  return `${origin}/${normalizedPath}`;
}
