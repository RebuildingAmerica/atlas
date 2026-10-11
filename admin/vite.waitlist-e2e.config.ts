/** Node Vite harness only. Deployed Worker builds never import the local Access authority. */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const directory = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  plugins: [tanstackStart(), react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /^(?:@\/server\/admin-runtime|\.\/admin-runtime)$/,
        replacement: resolve(
          directory,
          "tests/helpers/waitlist-e2e-runtime.ts",
        ),
      },
      { find: "@", replacement: resolve(directory, "src") },
    ],
  },
});
