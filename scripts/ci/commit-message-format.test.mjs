import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function format(message) {
  const directory = mkdtempSync(join(tmpdir(), "atlas-commit-format-"));
  const path = join(directory, "message");
  try {
    writeFileSync(path, message);
    execFileSync("bash", ["scripts/validation/format-commit-message.sh", path]);
    return readFileSync(path, "utf8");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("reflows fragmented prose as a paragraph instead of stranding short lines", () => {
  const input = "chore(api): Defer loading the name model\n\nImporting the model loads tables before running a\nsingle\ntest. Only the officer check needs the model, so it imports it\nthere.\n";
  const output = format(input);
  const body = output.trimEnd().split("\n").slice(2);
  assert.equal(body.length, 2);
  assert.ok(body.every((line) => line.length <= 72));
  assert.equal(output.replace(/\s+/g, " ").trim(), input.replace(/\s+/g, " ").trim());
});

test("preserves paragraph boundaries and structured message content", () => {
  const input = "chore(dx): Keep commit history readable\n\nFirst paragraph.\nSecond sentence.\n\nAnother paragraph.\n\n- A structured item\n  with an intentional continuation\n\n```sh\ncommand with deliberately spaced arguments\n```\n# An editor comment\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n\nCo-authored-by: Codex <noreply@openai.com>\n";
  const output = format(input);
  assert.match(output, /First paragraph\. {1,2}Second sentence\.\n\nAnother paragraph\./);
  assert.equal(output.slice(output.indexOf("\n- ")), input.slice(input.indexOf("\n- ")));
});

test("wraps prose to 72 columns and is idempotent", () => {
  const input = `chore(dx): Keep commit history readable\n\n${"Readable release history protects reviewers from missing changes. ".repeat(8)}\n`;
  const output = format(input);
  assert.ok(output.split("\n").slice(1).every((line) => line.length <= 72));
  assert.equal(format(output), output);
});

test("preserves Markdown tables and blockquotes as structured lines", () => {
  const input = "docs: Record review evidence\n\n| Check | Result |\n| --- | --- |\n| Browser | Passed |\n\n> Keep first.\n> Keep second.\n";
  assert.equal(format(input), input);
});
