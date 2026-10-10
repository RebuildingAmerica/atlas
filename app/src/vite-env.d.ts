/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly ATLAS_MANAGED?: string;
  readonly ATLAS_MULTI_USER?: string;
  readonly ATLAS_AUTH_BASE_PATH?: string;
  readonly ATLAS_DOCS_URL?: string;
  readonly ATLAS_PUBLIC_URL?: string;
  readonly ATLAS_WEB_CANONICAL_URL?: string;
}

declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}
