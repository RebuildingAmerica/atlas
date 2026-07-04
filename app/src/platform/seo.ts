const DEFAULT_PUBLIC_ORIGIN = "https://atlas.rebuildingamerica.com";
const DEFAULT_SITE_NAME = "Atlas";
const DEFAULT_SOCIAL_IMAGE_PATH = "/social/atlas-card.png";
const DEFAULT_SOCIAL_IMAGE_WIDTH = "1200";
const DEFAULT_SOCIAL_IMAGE_HEIGHT = "630";

interface SeoEnv {
  ATLAS_PUBLIC_URL?: string;
}

export interface PageHeadInput {
  title: string;
  description: string;
  path: string;
  socialTitle?: string;
  type?: "website" | "profile" | "article";
  imagePath?: string;
  noindex?: boolean;
}

export interface HeadTitleMeta {
  title: string;
}

export interface HeadNameMeta {
  name: string;
  content: string;
}

export interface HeadPropertyMeta {
  property: string;
  content: string;
}

export type HeadMeta = HeadTitleMeta | HeadNameMeta | HeadPropertyMeta;

export interface HeadLink {
  rel: string;
  href: string;
}

export interface PageHead {
  meta: HeadMeta[];
  links: HeadLink[];
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

function buildSocialImageUrl(imagePath: string, env: SeoEnv): string {
  const trimmedPath = imagePath.trim();
  try {
    const url = new URL(trimmedPath);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return url.href;
    }
  } catch {
    // Relative paths are resolved against the configured canonical origin below.
  }

  return buildCanonicalUrl(trimmedPath || DEFAULT_SOCIAL_IMAGE_PATH, env);
}

export function buildPageHead(input: PageHeadInput, env: SeoEnv = import.meta.env): PageHead {
  const canonicalUrl = buildCanonicalUrl(input.path, env);
  const imageUrl = buildSocialImageUrl(input.imagePath ?? DEFAULT_SOCIAL_IMAGE_PATH, env);
  const socialTitle = input.socialTitle ?? input.title;
  const pageType = input.type ?? "website";
  const meta: HeadMeta[] = [
    { title: input.title },
    { name: "description", content: input.description },
    { property: "og:title", content: socialTitle },
    { property: "og:description", content: input.description },
    { property: "og:type", content: pageType },
    { property: "og:url", content: canonicalUrl },
    { property: "og:site_name", content: DEFAULT_SITE_NAME },
    { property: "og:image", content: imageUrl },
    { property: "og:image:width", content: DEFAULT_SOCIAL_IMAGE_WIDTH },
    { property: "og:image:height", content: DEFAULT_SOCIAL_IMAGE_HEIGHT },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: socialTitle },
    { name: "twitter:description", content: input.description },
    { name: "twitter:image", content: imageUrl },
  ];

  if (input.noindex) {
    meta.push({ name: "robots", content: "noindex,nofollow" });
  }

  return {
    meta,
    links: [{ rel: "canonical", href: canonicalUrl }],
  };
}
