# Cloudflare API runtime

The production API and discovery Workers preserve searchable profiles, public
sources, account access, and durable discovery jobs. Their Python runtimes use
SQLite Durable Objects with the existing PostgreSQL database through Hyperdrive.

Publish through the repository's **Deploy Production** workflow and its retained
release artifacts. See the
[release policy](../../docs/deployment/web-release-policy.md) for functional,
quota, performance, and rollback requirements. The standalone experimental
publishers have been removed.

`production/` contains the API and discovery entrypoints and consumer controls.
`compatibility/` supplies shared runtime adapters, package bootstrapping, and
provider compatibility checks used by those builds. `public-edge/` provides the
public API dispatcher. Keep these sources together when building an artifact.

The locked Python WebAssembly packages and native wheels are built by the
repository's **Build Cloudflare Python wheels** workflow. The release tooling
checks artifact hashes and provenance before packaging them; source compilation
alone does not establish hosted behavior. See the
[Python validation evidence](../../docs/deployment/cloudflare-python-validation.md).

The pinned `cf` CLI requires `patches/cf@1.0.0-beta.14.patch` so uploaded Python
package names retain their `python_modules/` prefix. Artifact tests exercise the
CLI's upload adapter and verify that JavaScript module naming is preserved.
