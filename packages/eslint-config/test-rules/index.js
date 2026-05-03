import noBannedGlobalsInTests from "./no-banned-globals-in-tests.js";
import noTestFileLocals from "./no-test-file-locals.js";

/**
 * The shared `atlas-tests` ESLint plugin.
 *
 * Holds rules that enforce test-file hygiene across every Atlas TypeScript
 * workspace — top-level declarations forbidden, no direct mutation of
 * `process.env` / `global.fetch` / `globalThis.*` from inside a test, etc.
 */
export const atlasTestsPlugin = {
  meta: {
    name: "atlas-tests",
    version: "0.0.0",
  },
  rules: {
    "no-banned-globals-in-tests": noBannedGlobalsInTests,
    "no-test-file-locals": noTestFileLocals,
  },
};
