import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export function collectUnitTestFiles(): string[] {
  return collectTestFiles(join(process.cwd(), "tests/unit"));
}

export function pathContainsTestFile(shardPath: string, testFile: string): boolean {
  return testFile === shardPath || testFile.startsWith(`${shardPath}/`);
}

function collectTestFiles(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      const stats = statSync(path);

      if (stats.isDirectory()) {
        return collectTestFiles(path);
      }

      return /\.(test)\.(ts|tsx)$/.test(entry) ? [path] : [];
    })
    .map((path) => relative(process.cwd(), path))
    .sort();
}
