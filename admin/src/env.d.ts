/// <reference types="vite/client" />

/**
 * The one part of the Workers runtime module the admin reads: its settings and
 * secrets, and its private API runtime binding.
 */
declare module "cloudflare:workers" {
  import type { AdminRuntimeSource } from "@/server/admin-runtime";
  export const env: Readonly<AdminRuntimeSource>;
}
