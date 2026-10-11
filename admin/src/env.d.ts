/// <reference types="vite/client" />

/**
 * The one part of the Workers runtime module the admin reads: its settings and
 * secrets, as plain strings.
 */
declare module "cloudflare:workers" {
  export const env: Readonly<Record<string, string | undefined>>;
}
