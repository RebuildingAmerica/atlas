import { defineConfig } from "cf/config";
// Node loads this file directly, so the import names its extension.
import { adminWorkerConfig } from "./src/platform/worker-config.ts";

export default defineConfig({
  worker: (context) => adminWorkerConfig(process.env, context),
});
