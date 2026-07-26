import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addEntries,
  emptyTree,
  fakeDirectory,
  fakeFile,
  fakeOther,
  installFakeFs,
  runBudgetScript,
  ASSETS_DIR,
  KIB,
  MIB,
  type FakeAssetTree,
} from "./check-bundle-budget-test-support";

describe("check-bundle-budget", () => {
  let errors: string[];
  let warnings: string[];

  beforeEach(() => {
    errors = [];
    warnings = [];
    vi.spyOn(console, "error").mockImplementation((message: unknown) => {
      errors.push(String(message));
    });
    vi.spyOn(console, "warn").mockImplementation((message: unknown) => {
      warnings.push(String(message));
    });
    process.exitCode = undefined;
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("node:fs/promises");
    process.exitCode = undefined;
  });

  /** A tree where every budget is satisfied. */
  function passingTree(): FakeAssetTree {
    const tree = emptyTree();
    tree.directories[ASSETS_DIR] = [
      fakeFile(tree, ASSETS_DIR, "index-abc123.js", 400 * KIB),
      fakeFile(tree, ASSETS_DIR, "browse-abc123.js", 100 * KIB),
      fakeFile(tree, ASSETS_DIR, "map-abc123.js", 40 * KIB),
      fakeFile(tree, ASSETS_DIR, "people-abc123.js", 50 * KIB),
      fakeFile(tree, ASSETS_DIR, "maplibre-gl-abc123.js", 900 * KIB),
      fakeFile(tree, ASSETS_DIR, "maplibre-gl-csp-worker-abc123.js", 400 * KIB),
    ];
    return tree;
  }

  it("passes and reports every budget when the bundle is within limits", async () => {
    installFakeFs(passingTree());

    await runBudgetScript();

    expect(process.exitCode).not.toBe(1);
    expect(warnings.join("\n")).toContain("Bundle budget passed");
    expect(warnings.join("\n")).toContain("main public JS");
    expect(warnings.join("\n")).toContain("total public assets");
    expect(errors).toEqual([]);
  });

  it("fails the run when a chunk is over its budget", async () => {
    const tree = passingTree();
    tree.sizes[`${ASSETS_DIR}/browse-abc123.js`] = 300 * KIB;
    installFakeFs(tree);

    await runBudgetScript();

    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toContain("Bundle budget failed");
    expect(errors.join("\n")).toContain("browse route JS");
  });

  it("fails the run when a budgeted chunk is missing entirely", async () => {
    const tree = emptyTree();
    tree.directories[ASSETS_DIR] = [fakeFile(tree, ASSETS_DIR, "index-abc123.js", 10 * KIB)];
    installFakeFs(tree);

    await runBudgetScript();

    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toContain("browse route JS");
    expect(errors.join("\n")).toContain("missing");
  });

  it("fails the run when the assets total exceeds the overall budget", async () => {
    const tree = passingTree();
    addEntries(tree, ASSETS_DIR, fakeFile(tree, ASSETS_DIR, "ballast-1.css", 3 * MIB));
    installFakeFs(tree);

    await runBudgetScript();

    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toContain("total public assets");
  });

  it("walks nested directories and ignores entries that are neither file nor directory", async () => {
    const tree = passingTree();
    const nested = `${ASSETS_DIR}/nested`;
    addEntries(tree, ASSETS_DIR, fakeDirectory("nested"), fakeOther("a-symlink"));
    tree.directories[nested] = [fakeFile(tree, nested, "extra-abc123.css", 2 * KIB)];
    installFakeFs(tree);

    await runBudgetScript();

    expect(process.exitCode).not.toBe(1);
    // Seven assets counted: six at the root plus the nested one; the symlink is skipped.
    expect(warnings.join("\n")).toContain("7 assets");
  });

  it("summarises a large matching set by count rather than by name", async () => {
    const tree = passingTree();
    for (let index = 0; index < 6; index += 1) {
      addEntries(
        tree,
        ASSETS_DIR,
        fakeFile(tree, ASSETS_DIR, `organizations-chunk${index.toString()}.js`, KIB),
      );
    }
    installFakeFs(tree);

    await runBudgetScript();

    expect(warnings.join("\n")).toContain("7 assets)");
  });

  it("reports sizes in MiB once a budget group crosses a mebibyte", async () => {
    const tree = passingTree();
    tree.sizes[`${ASSETS_DIR}/maplibre-gl-abc123.js`] = 1.1 * MIB;
    installFakeFs(tree);

    await runBudgetScript();

    expect(warnings.join("\n")).toContain("MiB");
    expect(warnings.join("\n")).toContain("KiB");
  });

  it("reports the message when the assets directory cannot be read", async () => {
    installFakeFs(emptyTree(), new Error("no such directory"));

    await runBudgetScript();

    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toContain("no such directory");
  });

  it("reports a non-Error rejection as-is", async () => {
    installFakeFs(emptyTree(), "readdir exploded");

    await runBudgetScript();

    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toContain("readdir exploded");
  });
});
