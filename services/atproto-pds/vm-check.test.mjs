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

function fixture(t, denied, emptyQuotedKey, retainedSource) {
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
  let current = denied
    ? contents.replace(/^PDS_JWT_SECRET=.+$/m, "PDS_JWT_SECRET=")
    : contents;
  if (emptyQuotedKey)
    current = current.replace(
      new RegExp(`^${emptyQuotedKey}=.+$`, "m"),
      `${emptyQuotedKey}=""`,
    );
  if (retainedSource)
    current = current.replace(
      /^PDS_(?:ADMIN_PASSWORD|JWT_SECRET|PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX)=.+$/gm,
      (line) => line.split("=")[0] + "=",
    );
  writeFileSync(file, current, { mode: 0o600 });
  const before = readFileSync(file);
  if (!retainedSource)
    writeFileSync(join(deploy, "pds.env.previous"), contents, { mode: 0o600 });
  if (retainedSource === "sibling") {
    mkdirSync(deploy + ".previous");
    writeFileSync(join(deploy + ".previous", "pds.env"), contents, {
      mode: 0o600,
    });
  }
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
 if url.endswith('/startup-script'):return io.BytesIO(os.environ['FIXTURE_STARTUP'].encode())
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
if(args[0]==='ps')console.log('1'.repeat(64)+(process.env.FIXTURE_RETAINED.endsWith('container')&&!args.some(arg=>arg.startsWith('label=com.docker.compose.project.working_dir='))?'\\n'+'2'.repeat(64):''));
else if(args[0]==='inspect'){
 const old=args.at(-1)==='2'.repeat(64), retained=process.env.FIXTURE_RETAINED;
 const env=retained&&!old?['PDS_HOSTNAME=pds.example.org']:['PDS_HOSTNAME=pds.example.org','PDS_ADMIN_PASSWORD='+process.env.FIXTURE_PRIVATE,'PDS_JWT_SECRET='+process.env.FIXTURE_PRIVATE+'-jwt','PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX='+'1'.repeat(64)];
 console.log(JSON.stringify([{Id:args.at(-1),State:{Status:old?'exited':'running',Health:{Status:process.env.FIXTURE_DENIED==='true'?'unhealthy':'healthy'}},Config:{Env:env,Labels:{'com.docker.compose.project.working_dir':process.env.ATLAS_PDS_DEPLOY_DIRECTORY+(old?'.previous':'')}},Mounts:[{Source:process.env.ATLAS_PDS_DATA_DIRECTORY+(old&&retained==='foreign-container'?'.unrelated':''),Destination:'/pds'}]}]));
}
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
        FIXTURE_RETAINED: retainedSource ?? "",
        FIXTURE_STARTUP:
          retainedSource === "metadata"
            ? contents
            : retainedSource === "metadata-expansion"
              ? contents.replace(
                  /^PDS_JWT_SECRET=.+$/m,
                  "PDS_JWT_SECRET=$(read_secret original)",
                )
              : "#!/bin/bash\n",
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

for (const key of ["PDS_ADMIN_PASSWORD", "PDS_JWT_SECRET"])
  test(`host check refuses an empty quoted ${key} as recoverable configuration`, (t) => {
    const { result, report } = fixture(t, false, key);
    assert.notEqual(result.status, 0);
    const current = report.configurationCandidates.find((row) =>
      row.path.endsWith("/pds.env"),
    );
    assert.equal(current.credentialsPresent[key], false);
    assert.equal(current.complete, false);
  });

for (const source of ["sibling", "container", "metadata"])
  test(`host check locates original configuration in retained ${source} without accepting the broken current PDS`, (t) => {
    const { result, report, commands } = fixture(t, true, undefined, source);
    assert.notEqual(result.status, 0);
    assert.equal(report.recoveryConfigurationAvailable, true);
    assert.ok(
      report.configurationCandidates
        .concat(report.containers)
        .some((row) => row.complete),
    );
    assert.ok(commands.every((args) => ["ps", "inspect"].includes(args[0])));
  });

test("startup commands are not treated as recovered credential values", (t) => {
  const { report } = fixture(t, true, undefined, "metadata-expansion");
  assert.equal(report.recoveryConfigurationAvailable, false);
  const metadata = report.configurationCandidates.find(
    (row) => row.source === "startup-metadata",
  );
  assert.equal(metadata.credentialsPresent.PDS_JWT_SECRET, false);
});

test("credentials attached to another data disk do not qualify for recovery", (t) => {
  const { report } = fixture(t, true, undefined, "foreign-container");
  assert.equal(report.recoveryConfigurationAvailable, false);
  assert.equal(report.containers.length, 1);
});
