import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Ensures the shared end-to-end cache directory exists before the browser run.
 *
 * Playwright may start configured web servers before this hook executes. The
 * destructive cleanup lives in the dedicated `e2e:cleanup` script that Turbo
 * runs before `test:e2e`; deleting the cache here would remove live SQLite
 * databases from under already-running services.
 */
export default function globalSetup() {
  const e2eDir = path.join(process.cwd(), "node_modules", ".cache", "e2e");
  mkdirSync(e2eDir, { recursive: true });
}
