/**
 * Bans direct mutation of process.env / global.fetch / globalThis.* in tests.
 * Reads are fine; only assignments are flagged.
 *
 * Use:
 *   - vi.stubEnv(name, value) / vi.unstubAllEnvs()  instead of process.env.X = …
 *   - vi.spyOn(global, "fetch")                     instead of global.fetch = …
 *   - vi.useFakeTimers() + vi.advanceTimersByTimeAsync()  instead of overriding globalThis.setTimeout
 */

function isProcessEnvWrite(node) {
  // node is AssignmentExpression with left = MemberExpression chain
  let left = node.left;
  // process.env.X = ...
  if (
    left.type === "MemberExpression" &&
    left.object.type === "MemberExpression" &&
    left.object.object.type === "Identifier" &&
    left.object.object.name === "process" &&
    left.object.property.type === "Identifier" &&
    left.object.property.name === "env"
  ) {
    return true;
  }
  // process.env = ...
  if (
    left.type === "MemberExpression" &&
    left.object.type === "Identifier" &&
    left.object.name === "process" &&
    left.property.type === "Identifier" &&
    left.property.name === "env"
  ) {
    return true;
  }
  return false;
}

function isGlobalWrite(node, name) {
  const left = node.left;
  if (left.type !== "MemberExpression") return false;
  if (left.property.type !== "Identifier" || left.property.name !== name) {
    return false;
  }
  if (left.object.type !== "Identifier") return false;
  return ["global", "globalThis", "window", "self"].includes(left.object.name);
}

function isGlobalThisAnyWrite(node) {
  const left = node.left;
  if (left.type !== "MemberExpression") return false;
  if (left.object.type !== "Identifier") return false;
  return ["global", "globalThis"].includes(left.object.name);
}

const RULE = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct mutation of process.env, global.fetch, and other global state in tests; use vi.stubEnv / vi.spyOn / vi.useFakeTimers instead.",
    },
    schema: [],
    messages: {
      processEnv:
        "Do not assign to process.env in tests. Use `vi.stubEnv(name, value)` (and `vi.unstubAllEnvs()` in afterEach) instead.",
      globalFetch:
        "Do not assign to global.fetch in tests. Use `vi.spyOn(global, 'fetch').mockImplementation(...)` (auto-cleaned by vi.restoreAllMocks).",
      globalAny:
        "Do not mutate {{accessor}} in tests. Use the appropriate vi.* utility (vi.stubEnv, vi.spyOn, vi.useFakeTimers) so cleanup is automatic.",
    },
  },
  create(context) {
    return {
      AssignmentExpression(node) {
        if (isProcessEnvWrite(node)) {
          context.report({ node, messageId: "processEnv" });
          return;
        }
        if (isGlobalWrite(node, "fetch")) {
          context.report({ node, messageId: "globalFetch" });
          return;
        }
        if (isGlobalThisAnyWrite(node)) {
          const accessor = `${node.left.object.name}.${
            node.left.property.type === "Identifier"
              ? node.left.property.name
              : "<computed>"
          }`;
          context.report({
            node,
            messageId: "globalAny",
            data: { accessor },
          });
        }
      },
    };
  },
};

export default RULE;
