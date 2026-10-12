import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function fixture(t, denied) {
  const root = mkdtempSync(join(tmpdir(), "atlas-pds-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const deploy = join(root, "deploy"),
    data = join(root, "data"),
    bin = join(root, "bin");
  for (const path of [deploy, data, bin]) mkdirSync(path);
  const privateValue = "private-" + "fixture".repeat(8);
  const contents = [
    "ATLAS_PDS_HOSTNAME=pds.example.org",
    `ATLAS_PDS_DATA_DIRECTORY=${data}`,
    `PDS_ADMIN_PASSWORD=${privateValue}`,
    `PDS_JWT_SECRET=${privateValue}-jwt`,
    "PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX=" + "1".repeat(64),
    "",
  ].join("\n");
  const file = join(deploy, "pds.env");
  writeFileSync(
    file,
    denied
      ? contents.replace(/^PDS_JWT_SECRET=.+$/m, "PDS_JWT_SECRET=")
      : contents,
    { mode: 0o600 },
  );
  const before = readFileSync(file);
  writeFileSync(join(deploy, "pds.env.previous"), contents, { mode: 0o600 });
  const python = spawnSync(
    "python3",
    ["-c", "import sys; print(sys.executable)"],
    { encoding: "utf8" },
  ).stdout.trim();
  writeFileSync(
    join(bin, "python3"),
    `#!${python}
import sys,os,io,json,urllib.request,urllib.error
def request(req,timeout=None):
 url=req.full_url
 if url.endswith('/email'):return io.BytesIO(b'pds-runtime@fixture-project.iam.gserviceaccount.com')
 if url.endswith('/scopes'):return io.BytesIO(b'https://www.googleapis.com/auth/cloud-platform')
 if url.endswith('/token'):return io.BytesIO(json.dumps({'access_token':os.environ['FIXTURE_PRIVATE']+'-token'}).encode())
 if '/secrets/' in url:
  if os.environ['FIXTURE_DENIED']=='true':raise urllib.error.HTTPError(url,403,'private-message',{},io.BytesIO(json.dumps({'error':{'status':'PERMISSION_DENIED','message':os.environ['FIXTURE_PRIVATE'],'details':[{'reason':'ACCESS_TOKEN_SCOPE_INSUFFICIENT'}]}}).encode()))
  return io.BytesIO(json.dumps({'payload':{'data':'Zml4dHVyZS12YWx1ZQ=='}}).encode())
 raise RuntimeError('Unexpected endpoint')
urllib.request.urlopen=request
exec(compile(sys.stdin.read(),'<vm-check>','exec'))
`,
    { mode: 0o755 },
  );
  const log = join(root, "docker.jsonl");
  writeFileSync(
    join(bin, "docker"),
    `#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify(args)+'\\n');
if(args[0]==='ps')console.log('1'.repeat(64));
else if(args[0]==='inspect')console.log(JSON.stringify([{Id:'1'.repeat(64),State:{Status:'running',Health:{Status:process.env.FIXTURE_DENIED==='true'?'unhealthy':'healthy'}},Config:{Env:['PDS_HOSTNAME=pds.example.org','PDS_ADMIN_PASSWORD='+process.env.FIXTURE_PRIVATE,'PDS_JWT_SECRET='+process.env.FIXTURE_PRIVATE+'-jwt','PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX='+'1'.repeat(64)]}}]));
else process.exit(99);
`,
    { mode: 0o755 },
  );
  const result = spawnSync(
    "bash",
    [resolve("services/atproto-pds/vm-check.sh")],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        ATLAS_PDS_DEPLOY_DIRECTORY: deploy,
        ATLAS_PDS_DATA_DIRECTORY: data,
        ATLAS_PDS_HOSTNAME: "pds.example.org",
        ATLAS_PDS_ENVIRONMENT: "production",
        ATLAS_PDS_GCP_PROJECT: "fixture-project",
        FIXTURE_LOG: log,
        FIXTURE_PRIVATE: privateValue,
        FIXTURE_DENIED: String(denied),
      },
    },
  );
  assert.ok(
    result.stdout.trim().startsWith("{"),
    "Host check must return a structured report",
  );
  assert.equal(result.stdout.includes(privateValue), false);
  assert.equal(result.stderr.includes(privateValue), false);
  assert.deepEqual(readFileSync(file), before);
  return {
    result,
    report: JSON.parse(result.stdout),
    commands: readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  };
}

test("host check finds retained configuration and reports denied Secret Manager scopes without exposing values or mutating Docker", (t) => {
  const { result, report, commands } = fixture(t, true);
  assert.notEqual(result.status, 0);
  assert.equal(report.status, "blocked");
  assert.ok(
    report.configurationCandidates.some(
      (row) => row.path.endsWith("pds.env.previous") && row.complete,
    ),
  );
  assert.ok(report.containers.some((row) => row.health === "unhealthy"));
  assert.equal(report.secretManager.length, 3);
  assert.ok(
    report.secretManager.every(
      (row) =>
        row.httpStatus === 403 &&
        row.reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
    ),
  );
  assert.ok(commands.every((args) => ["ps", "inspect"].includes(args[0])));
});

test("host check proves existing healthy configuration and scoped secret availability without printing payloads", (t) => {
  const { result, report, commands } = fixture(t, false);
  assert.equal(result.status, 0);
  assert.equal(report.status, "pass");
  assert.ok(
    report.secretManager.every((row) => row.httpStatus === 200 && row.present),
  );
  assert.ok(commands.every((args) => ["ps", "inspect"].includes(args[0])));
});
