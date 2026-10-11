import { defineWranglerConfig } from "wrangler/experimental-config";

// cf owns the CLI; its supported bundler compiles the small asset/proxy Worker.
export default defineWranglerConfig({
  assetsDirectory: "../../app/.output/public",
  minify: true,
  types: { generate: false },
});
