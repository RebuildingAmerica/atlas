# Scout Homebrew Tap Runbook

Scout is a user-facing CLI. The public install path is:

```bash
brew install rebuildingamerica/tap/atlas-scout
```

The formula installs only `scout`. `scout-dev` stays repo-local because it
injects local Atlas development URLs and certificates.

## Release Shape

Scout releases use Atlas tags shaped like:

```bash
atlas-scout-vX.Y.Z
```

The release workflow:

1. Runs the shared, discovery-engine, and Scout package tests.
2. Builds `atlas-scout-X.Y.Z.tar.gz` from the Atlas source tree.
3. Generates a deterministic SHA256 checksum.
4. Renders `Formula/atlas-scout.rb` from the Scout lockfile.
5. Publishes the archive and checksum to a GitHub release.
6. Creates a build provenance attestation for both artifacts.
7. Opens a pull request in `RebuildingAmerica/homebrew-tap`.
8. Enables auto-merge so the tap updates after its CI passes.

The release archive contains:

- `LICENSE`
- `README.md`
- `libs/shared`
- `libs/discovery-engine`
- `scout`

It excludes virtual environments, caches, coverage output, node modules, and
generated release artifacts.

## GitHub App

The Atlas release workflow writes to the tap with a GitHub App installation
token. Configure these Atlas repository settings before the first tag release:

- Variable: `REBUILDING_AMERICA_RELEASE_APP_CLIENT_ID`
- Secret: `REBUILDING_AMERICA_RELEASE_APP_PRIVATE_KEY`

Install the app on `RebuildingAmerica/homebrew-tap` with:

- Contents: read and write
- Pull requests: read and write
- Metadata: read

The normal repository `GITHUB_TOKEN` creates the Atlas release and provenance
attestation. The app token is only for the tap checkout, branch push, pull
request, and auto-merge request.

## Local Checks

Before pushing a Scout tag, run:

```bash
pnpm release:homebrew:test
pnpm exec turbo run @rebuildingamerica/atlas-shared#test @rebuildingamerica/atlas-discovery-engine#test @rebuildingamerica/atlas-scout#test
uv --directory scout run scout --help
pnpm release:homebrew --tag atlas-scout-v0.1.0 --output-dir dist/scout-homebrew
```

Use the real version tag in the final command. The generated `dist/` files are
ignored and should not be committed.

## Tap Repository

The tap repository should contain:

- `Formula/atlas-scout.rb`
- `.github/workflows/ci.yml`
- `README.md`

Tap CI should run on macOS and check:

```bash
brew audit --strict --online Formula/atlas-scout.rb
brew install --build-from-source Formula/atlas-scout.rb
scout --help
scout db path
brew uninstall atlas-scout
```

Do not use `scout doctor --json` as a formula or tap CI gate. `doctor` is a
readiness check and correctly exits nonzero on a clean machine without a local
model, search credentials, or Atlas login.

## Cut A Release

1. Update the version in `scout/pyproject.toml`, `libs/shared/pyproject.toml`,
   and `libs/discovery-engine/pyproject.toml`.
2. Run the local checks above.
3. Commit the version bump.
4. Tag the commit:

   ```bash
   git tag atlas-scout-vX.Y.Z
   git push origin atlas-scout-vX.Y.Z
   ```

5. Watch the Scout Release workflow.
6. Wait for the tap pull request to pass CI and auto-merge.
7. Verify the user install path:

   ```bash
   brew update
   brew install rebuildingamerica/tap/atlas-scout
   scout --help
   scout setup
   ```

## Browser Dependency

The formula installs the Playwright Python package because Scout can use
headless Chromium for JavaScript-rendered pages. It does not download Chromium
during `brew install`.

Users who need JavaScript rendering should run:

```bash
$(brew --prefix atlas-scout)/libexec/bin/playwright install chromium
```
