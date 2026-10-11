# Cloudflare API runtime evaluation

This read-only candidate tests the provider runtime needed to preserve search
and source-linked profiles while moving Atlas's API off Google-hosted compute.
It is not the Atlas API and cannot be promoted to production. It neither runs
migrations nor modifies user or catalog records.

Build the locked Python 3.14 WebAssembly environment:

```sh
python3 scripts/deploy/api-cloudflare-dependencies.py
```

From a clean committed checkout, deploy the protected candidate using the new
`cf` CLI. Select the verified Atlas account/profile explicitly and supply the
existing runtime and Access credential files, uncached Hyperdrive ID, and zone:

```sh
node scripts/deploy/api-cloudflare-evaluation.mjs \
  --runtime-file /private/path/runtime.json \
  --access-file /private/path/access.json \
  --hyperdrive-id EXISTING_HYPERDRIVE_ID \
  --zone-id ATLAS_ZONE_ID \
  --vendor .atlas/python-compatibility-dependencies/lib/python3.14/site-packages
```

The publisher verifies Workers Free, PostgreSQL identity, disabled query
caching, and exclusive Access protection before attaching a hostname. Provider
output and probe bodies remain private under
`.atlas/python-evaluation/<commit>/`; the report records deployment identity and
artifact digest before HTTP verification, so DNS/TLS provisioning failures do
not erase a successful deployment.

The pinned `cf` beta needs `patches/cf@1.0.0-beta.14.patch`: prebuilt Python
package names must retain `python_modules/` as their prefix. The unpatched CLI
adds `./` and the provider excludes those files from the package directory.
Behavioral tests exercise cf's real upload adapter and retain JavaScript naming.

FastAPI runs inside a Python SQLite Durable Object. PostgreSQL is request-scoped
through `asyncpg`, with UTC configuration and explicit connection cleanup. The
initial `psycopg` probe failed because its native `libpq` dependency was absent;
documented driver support alone did not make that installed package usable. The
Python edge forwarding path still needs measured CPU validation; use a
JavaScript edge dispatcher if it cannot meet Workers Free's CPU limit.

The first 20-request warm sample reached 11ms CPU at the Python edge. Repeat the
same publication command with `--edge` to build the small JavaScript dispatcher,
bound directly to the existing Python object. Its report records the observed
Python deployment version as a dependency. This is a separate protected
evaluation hostname and does not change production routing.

The full discovery graph requires native `inflate64` and `python-crfsuite`
packages, which lack compatible prebuilt wheels in the evaluated indexes.
`Build Cloudflare Python wheels` cross-compiles their existing versions on
standard GitHub runners without deployment secrets. The exact locked validation
and parsing native packages also have build targets; XML and cryptographic
libraries use pinned upstream static-library recipes with source hashes from
`api/uv.lock`. See
[hosted evidence](../../docs/deployment/cloudflare-python-validation.md).
Successful compilation alone is not acceptance: deployed archive decoding and
name parsing must match existing behavior before discovery moves. No extraction
capability is disabled.

The complete API build uses the same lockfile and native build artifacts:

```sh
python3 scripts/deploy/api-cloudflare-native-dependencies.py --run WHEEL_RUN_ID --full-api
```

This also builds and includes the existing MCP profile widgets. Deploy with
`--vendor .atlas/python-api-dependencies --packages-asset` to keep the immutable
pure-package archive outside the Python code upload. Its SHA-256 is verified at
runtime; native libraries stay in the package filesystem.

For protected actual API routes, add `--api-settings-file` pointing to the
private JSON output of `gcloud run services describe atlas-api --format=json`
with the explicit original account, project and region. This is a read-only
recovery operation. The publisher verifies production identity and database
against the web runtime, then passes settings using cf's private secrets-file
interface. Settings never enter the build artifact or manifest. `/imports`
constructs the configured API; `/atlas/*` exposes its existing routes under the
protected evaluation prefix. HTTP requests do not run migrations or start
process polling; each request owns its connections and MCP manager through
response completion. This still does not qualify a production release or prove
durable discovery execution.

To install the archive and name-parsing packages from a completed, reviewed
repository wheel build, run the verified installer. It checks the workflow's
source ancestry and each downloaded artifact hash; pure Python package hashes
come from Atlas's existing API lock. Then add `--native` to the evaluation
publisher to require the deployed discovery examples to pass.

```sh
python3 scripts/deploy/api-cloudflare-native-dependencies.py --run WHEEL_RUN_ID
```

The source checkout must include the wheel workflow's commit. An expired or
missing artifact fails explicitly; run the repository wheel workflow again. This
native check covers Deflate64 decoding and the existing person, bank, and
annotated-name classification examples. Full discovery remains a separate gate.
