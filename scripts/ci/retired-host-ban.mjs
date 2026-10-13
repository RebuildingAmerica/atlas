import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const blocked = Buffer.from("dmVyY2Vs", "base64").toString("utf8");
const excluded = ["pnpm-lock.yaml", "node_modules/", ".git/", ".turbo/"];
const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .filter(existsSync)
  .filter((file) => !excluded.some((prefix) => file === prefix || file.startsWith(prefix)));
const matches = files.filter((file) =>
  readFileSync(file, "utf8").toLowerCase().includes(blocked),
);

if (matches.length) {
  console.error(`Retired hosting references found:\n${matches.join("\n")}`);
  process.exitCode = 1;
}
