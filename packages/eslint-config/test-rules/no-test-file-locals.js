/**
 * Forbids non-test top-level declarations in `*.test.ts(x)` files.
 *
 * Permitted at the program top level:
 *   - ImportDeclaration
 *   - ExpressionStatement whose expression is a CallExpression to:
 *       describe / describe.skip / describe.only / describe.each
 *       it / test (and their .skip/.only/.each variants)
 *       beforeAll / beforeEach / afterAll / afterEach
 *       vi.mock / vi.unmock / vi.doMock / vi.doUnmock / vi.hoisted
 *
 * Anything else (const/let/var, function, class, type alias, interface, enum,
 * export, re-implemented helper) must be extracted into
 * tests/{fixtures,mocks,helpers}/<feature>/<file>.ts and imported.
 */

const ALLOWED_GLOBAL_CALLS = new Set([
  "describe",
  "it",
  "test",
  "beforeAll",
  "beforeEach",
  "afterAll",
  "afterEach",
  "suite",
]);

const ALLOWED_VI_MEMBERS = new Set([
  "mock",
  "unmock",
  "doMock",
  "doUnmock",
  "hoisted",
]);

/**
 * Allow `const X = vi.hoisted(() => ...)` at the program top level — this
 * declaration is the documented way to surface hoisted mock dependencies and
 * must live at module scope for vi.mock factory hoisting to see it.
 */
function isViHoistedDeclaration(node) {
  if (!node.declarations || node.declarations.length === 0) return false;
  return node.declarations.every((decl) => {
    if (decl.type !== "VariableDeclarator") return false;
    if (!decl.init) return false;
    let init = decl.init;
    if (init.type === "AwaitExpression") init = init.argument;
    if (init.type !== "CallExpression") return false;
    const callee = init.callee;
    if (callee.type !== "MemberExpression") return false;
    if (callee.object.type !== "Identifier" || callee.object.name !== "vi") {
      return false;
    }
    if (callee.property.type !== "Identifier") return false;
    return callee.property.name === "hoisted";
  });
}

function isAllowedTopLevelCall(node) {
  if (node.type !== "ExpressionStatement") return false;
  let expr = node.expression;
  // Strip `await` (e.g. await vi.hoisted(...) is unusual but tolerate)
  if (expr.type === "AwaitExpression") expr = expr.argument;
  if (expr.type !== "CallExpression") return false;

  let callee = expr.callee;

  // Unwrap chained members: describe.skip(...), it.each(...)(...), vi.mock(...)
  // For chains we only look at the root identifier.
  while (callee.type === "MemberExpression") {
    callee = callee.object;
  }
  // Handle CallExpression callee (e.g. it.each(table)(name, fn))
  if (callee.type === "CallExpression") {
    let inner = callee.callee;
    while (inner.type === "MemberExpression") inner = inner.object;
    callee = inner;
  }

  if (callee.type !== "Identifier") return false;
  const root = callee.name;

  if (ALLOWED_GLOBAL_CALLS.has(root)) return true;

  if (root === "vi") {
    // Re-walk the original callee to find which vi.<member> was called
    let c = expr.callee;
    if (c.type === "MemberExpression" && c.property.type === "Identifier") {
      return ALLOWED_VI_MEMBERS.has(c.property.name);
    }
    return false;
  }

  return false;
}

const RULE = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Test files may only contain imports, vi.mock/hoisted calls, and describe/it/test/hooks. Extract everything else.",
    },
    schema: [],
    messages: {
      forbiddenDeclaration:
        "Top-level {{kind}} is forbidden in test files. Extract to tests/fixtures/, tests/mocks/, or tests/helpers/ and import it.",
      forbiddenStatement:
        "Top-level {{kind}} is forbidden in test files. Only imports, vi.mock/hoisted, and describe/it/test/hooks are allowed.",
      forbiddenExport:
        "Test files must not export. If this value is reusable, move it to tests/helpers/ (or fixtures/mocks/).",
    },
  },
  create(context) {
    return {
      Program(node) {
        for (const stmt of node.body) {
          switch (stmt.type) {
            case "ImportDeclaration":
              continue;
            case "ExportNamedDeclaration":
            case "ExportDefaultDeclaration":
            case "ExportAllDeclaration":
              context.report({ node: stmt, messageId: "forbiddenExport" });
              continue;
            case "VariableDeclaration":
              if (isViHoistedDeclaration(stmt)) continue;
              context.report({
                node: stmt,
                messageId: "forbiddenDeclaration",
                data: { kind: `${stmt.kind} declaration` },
              });
              continue;
            case "FunctionDeclaration":
              context.report({
                node: stmt,
                messageId: "forbiddenDeclaration",
                data: { kind: "function declaration" },
              });
              continue;
            case "ClassDeclaration":
              context.report({
                node: stmt,
                messageId: "forbiddenDeclaration",
                data: { kind: "class declaration" },
              });
              continue;
            case "TSTypeAliasDeclaration":
              context.report({
                node: stmt,
                messageId: "forbiddenDeclaration",
                data: { kind: "type alias" },
              });
              continue;
            case "TSInterfaceDeclaration":
              context.report({
                node: stmt,
                messageId: "forbiddenDeclaration",
                data: { kind: "interface" },
              });
              continue;
            case "TSEnumDeclaration":
              context.report({
                node: stmt,
                messageId: "forbiddenDeclaration",
                data: { kind: "enum" },
              });
              continue;
            case "ExpressionStatement":
              if (isAllowedTopLevelCall(stmt)) continue;
              context.report({
                node: stmt,
                messageId: "forbiddenStatement",
                data: { kind: "expression statement" },
              });
              continue;
            default:
              context.report({
                node: stmt,
                messageId: "forbiddenStatement",
                data: { kind: stmt.type },
              });
          }
        }
      },
    };
  },
};

export default RULE;
