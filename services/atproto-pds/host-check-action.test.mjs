import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("a first SSH connection preserves the complete read-only diagnostic on stdin", (t) => {
  const root = mkdtempSync(join(tmpdir(), "atlas-pds-action-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const action = readFileSync(
    resolve(".github/actions/deploy-atlas-pds/action.yml"),
    "utf8",
  );
  const step = action
    .split(
      "    - name: Check retained PDS host without changing configuration\n",
    )[1]
    ?.split("    - name:")[0];
  const script = step?.split("      run: |\n")[1]?.replace(/^        /gm, "");
  assert.ok(script, "The action must provide its host-check shell program");
  const python = spawnSync(
    "python3",
    ["-c", "import sys; print(sys.executable)"],
    { encoding: "utf8" },
  ).stdout.trim();
  writeFileSync(
    join(bin, "gcloud"),
    `#!${python}
import os,sys
args=sys.argv[1:]
if args[:2] != ['compute','ssh']:sys.exit(90)
if '--quiet' not in args:
 # The provider CLI prompts on its first connection; stdin is also the remote script.
 os.read(0, 150)
command=args[args.index('--command')+1]
os.execvp('bash',['bash','-c',command])
`,
    { mode: 0o755 },
  );
  writeFileSync(join(bin, "sudo"), '#!/bin/bash\nexec "$@"\n', { mode: 0o755 });
  writeFileSync(
    join(bin, "python3"),
    `#!${python}
import json,os,sys
source=sys.stdin.read()
compile(source,'<remote-diagnostic>','exec')
print(json.dumps({'status':'diagnostic-reached','hostname':os.environ['ATLAS_PDS_HOSTNAME']}))
`,
    { mode: 0o755 },
  );
  const result = spawnSync("bash", ["-c", script], {
    cwd: resolve("."),
    encoding: "utf8",
    timeout: 10000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ATLAS_PDS_ENVIRONMENT: "production",
      ATLAS_PDS_GCP_PROJECT: "fixture-project",
      ATLAS_PDS_HOSTNAME: "pds.example.org",
      ATLAS_PDS_PUBLIC_URL: "https://pds.example.org",
      ATLAS_PDS_DATA_DIRECTORY: "/var/lib/atlas-pds",
      ATLAS_PDS_DEPLOY_DIRECTORY: "/opt/atlas-pds",
      INSTANCE_NAME: "fixture-pds",
      INSTANCE_ZONE: "us-central1-a",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trim().startsWith("{"), result.stdout.slice(0, 600));
  assert.deepEqual(JSON.parse(result.stdout), {
    status: "diagnostic-reached",
    hostname: "pds.example.org",
  });
});
