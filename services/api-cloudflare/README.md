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

The full discovery graph requires native `inflate64` and `python-crfsuite`
packages, which lack compatible prebuilt wheels in the evaluated indexes.
`Build Cloudflare Python wheels` cross-compiles their existing versions on
standard GitHub runners without deployment secrets. Successful compilation alone
is not acceptance: deployed archive decoding and name parsing must match
existing behavior before discovery moves. No extraction capability is disabled.
