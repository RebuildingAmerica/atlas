import { expect, it } from "vitest";
import { workersExecutionEntry } from "../../vite.config";

it("keeps Node and direct Workers builds free of the durable wrapper", () => {
  expect(workersExecutionEntry("node", "direct")).toBeUndefined();
  expect(workersExecutionEntry("workers", "direct")).toBeUndefined();
});

it("selects distinct production and diagnostic entrypoints only for Workers", () => {
  expect(workersExecutionEntry("workers", "durable-production")).toBe(
    "server/durable-production.ts",
  );
  expect(workersExecutionEntry("workers", "durable-evaluation")).toBe(
    "server/durable-evaluation.ts",
  );
  for (const execution of ["durable-production", "durable-evaluation"])
    expect(() => workersExecutionEntry("node", execution)).toThrow("Workers build");
});

it("rejects unknown runtime and execution selections", () => {
  expect(() => workersExecutionEntry("browser", "direct")).toThrow("ATLAS_WEB_RUNTIME");
  expect(() => workersExecutionEntry("workers", "unknown")).toThrow("ATLAS_WORKERS_EXECUTION");
});
