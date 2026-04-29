import noTestFileLocals from "./no-test-file-locals.js";
import noBannedGlobalsInTests from "./no-banned-globals-in-tests.js";

export default {
  meta: {
    name: "atlas-tests",
    version: "0.0.0",
  },
  rules: {
    "no-test-file-locals": noTestFileLocals,
    "no-banned-globals-in-tests": noBannedGlobalsInTests,
  },
};
