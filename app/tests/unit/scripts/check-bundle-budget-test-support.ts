import { vi } from "vitest";

/** One entry as `readdir(..., { withFileTypes: true })` reports it. */
export interface FakeDirent {
  isDirectory: () => boolean;
  isFile: () => boolean;
  name: string;
}

/** A directory tree keyed by absolute path, plus a size for every file. */
export interface FakeAssetTree {
  directories: Record<string, FakeDirent[]>;
  sizes: Record<string, number>;
}

/** The directory the script reads, resolved the same way the script resolves it. */
export const ASSETS_DIR = `${process.cwd()}/.output/public/assets`;

export const KIB = 1024;
export const MIB = KIB * KIB;

/**
 * Builds a dirent for a file of a given size, recording the size so `stat`
 * can answer for it later.
 *
 * @param tree - The tree being assembled.
 * @param directory - Absolute path of the containing directory.
 * @param name - File name.
 * @param bytes - Size to report from `stat`.
 * @returns The dirent to place in the directory listing.
 */
export function fakeFile(
  tree: FakeAssetTree,
  directory: string,
  name: string,
  bytes: number,
): FakeDirent {
  tree.sizes[`${directory}/${name}`] = bytes;
  return { isDirectory: () => false, isFile: () => true, name };
}

/** A dirent the script should recurse into. */
export function fakeDirectory(name: string): FakeDirent {
  return { isDirectory: () => true, isFile: () => false, name };
}

/** A dirent that is neither file nor directory, such as a symlink. */
export function fakeOther(name: string): FakeDirent {
  return { isDirectory: () => false, isFile: () => false, name };
}

/** An empty tree ready to be filled. */
export function emptyTree(): FakeAssetTree {
  return { directories: {}, sizes: {} };
}

/**
 * Installs `node:fs/promises` mocks that serve the given tree.
 *
 * @param tree - Directory listings and file sizes to serve.
 * @param readdirError - When set, `readdir` rejects with it instead.
 */
export function installFakeFs(tree: FakeAssetTree, readdirError?: unknown): void {
  vi.doMock("node:fs/promises", () => ({
    readdir: (directory: string) => {
      if (readdirError !== undefined) {
        // Deliberately non-Error for one case: the script must render both.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject(readdirError);
      }
      return Promise.resolve(tree.directories[directory] ?? []);
    },
    stat: (path: string) => Promise.resolve({ size: tree.sizes[path] ?? 0 }),
  }));
}

/**
 * Imports the budget script, which runs its check on import, and waits for the
 * floating promise it starts to settle.
 */
export async function runBudgetScript(): Promise<void> {
  await import("@/../scripts/check-bundle-budget");
  for (let tick = 0; tick < 10; tick += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Appends entries to a directory listing without losing type information.
 *
 * @param tree - The tree being assembled.
 * @param directory - Absolute path of the directory to extend.
 * @param entries - Entries to append.
 */
export function addEntries(tree: FakeAssetTree, directory: string, ...entries: FakeDirent[]): void {
  const existing: FakeDirent[] = tree.directories[directory] ?? [];
  tree.directories[directory] = [...existing, ...entries];
}
