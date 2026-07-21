import { spawn } from "node:child_process";
import process from "node:process";

// Playwright's webServer kills its child on normal teardown, but it can't do
// that if Playwright itself is killed (an interrupted agent session, `kill
// -9`, OOM): SIGKILL can't be caught, so there's no code path left to run the
// cleanup, and the child is reparented to init and runs forever. Nothing can
// prevent that from Playwright's side. Instead, this wrapper runs *as* the
// webServer command, in its own process group, and polls its own ppid. The
// moment its parent disappears out from under it, it notices and kills the
// whole group itself — no dependence on some later process remembering to
// clean up.
const orphanPollIntervalMs = 2000;

const separatorIndex = process.argv.indexOf("--");
if (separatorIndex === -1 || separatorIndex === process.argv.length - 1) {
  throw new Error("Usage: run-until-orphaned.mjs -- <command> [args...]");
}

const [command, ...commandArgs] = process.argv.slice(separatorIndex + 1);
const parentPidAtStart = process.ppid;

const child = spawn(command, commandArgs, {
  stdio: "inherit",
  detached: true,
});

let settled = false;

function killChildGroup(signal) {
  if (child.pid == null) {
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    // Already exited.
  }
}

function shutdown(signal, exitCode) {
  if (settled) {
    return;
  }

  settled = true;
  clearInterval(orphanCheck);
  killChildGroup(signal);
  process.exit(exitCode);
}

const orphanCheck = setInterval(() => {
  if (process.ppid !== parentPidAtStart) {
    shutdown("SIGKILL", 1);
  }
}, orphanPollIntervalMs);

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => shutdown(signal, 0));
}

child.on("exit", (code, signal) => {
  clearInterval(orphanCheck);
  process.exit(signal ? 1 : (code ?? 0));
});
