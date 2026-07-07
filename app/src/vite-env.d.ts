/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly ATLAS_AUTH_BASE_PATH?: string;
  readonly ATLAS_DOCS_URL?: string;
  readonly ATLAS_DEPLOY_MODE?: string;
  readonly ATLAS_PUBLIC_URL?: string;
}

declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}
