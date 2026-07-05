# Scout Homebrew Tap Runbook

Scout should be installable as a normal user-facing CLI, not as a hidden
developer command. The intended install path is:

```bash
brew install rebuildingamerica/tap/atlas-scout
```

The tap does not exist yet. This runbook defines the release path so the public
Mintlify docs can switch to Homebrew once the formula is live.

## Product Boundary

- Homebrew installs only `scout`.
- `scout-dev` stays repo-local because it injects local Atlas development URLs
  and certificates.
- The formula must preserve Scout's trust boundary: local runs stay local until
  a user logs in and syncs them.

## Packaging Prerequisites

Scout currently depends on local monorepo packages:

- `libs/shared` -> `atlas-shared`
- `libs/discovery-engine` -> `atlas-discovery-engine`
- `scout` -> `atlas-scout`

Before publishing the tap, choose one stable packaging shape:

1. Publish all three Python packages to PyPI, then generate Homebrew Python
   resources from `atlas-scout`.
2. Build a GitHub release source archive that contains the monorepo paths and
   install those local packages in order from the formula.

Use option 2 for the first tap release. It avoids creating public PyPI packages
before the CLI versioning story is stable.

## Tap Repository

Create the public repository:

```bash
gh repo create RebuildingAmerica/homebrew-tap \
  --public \
  --description "Homebrew tap for Rebuilding America tools"
```

Clone it:

```bash
git clone git@github.com:RebuildingAmerica/homebrew-tap.git
cd homebrew-tap
mkdir -p Formula
```

## Formula Shape

Create `Formula/atlas-scout.rb` in the tap.

The formula should:

- Include `Language::Python::Virtualenv`.
- Depend on `python@3.12`.
- Install or document the Playwright Chromium browser dependency for the
  optional JavaScript rendering fallback.
- Use a tagged Atlas source archive.
- Install resources into `libexec`.
- Install local packages in this order: `libs/shared`,
  `libs/discovery-engine`, `scout`.
- Link only the `scout` executable.
- Test `scout --help` and `scout doctor --json`.

Do not add `scout-dev` to the formula.

## Resource Generation

After cutting a Scout release archive, generate dependency resources from a
temporary formula:

```bash
brew update-python-resources Formula/atlas-scout.rb --print-only
```

Copy the printed resources into the formula, then audit:

```bash
brew audit --strict --online Formula/atlas-scout.rb
```

Install from the local tap checkout:

```bash
brew install --build-from-source Formula/atlas-scout.rb
scout --help
scout doctor --json
```

Uninstall and confirm user data is not deleted:

```bash
brew uninstall atlas-scout
```

## Release Checklist

1. Update Scout version in `scout/pyproject.toml`.
2. Confirm `atlas-shared` and `atlas-discovery-engine` versions match the Scout
   release archive.
3. Run focused Scout tests.
4. Create an Atlas GitHub release tag for the Scout package.
5. Update the tap formula URL and SHA256.
6. Regenerate Python resources.
7. Open a pull request against `RebuildingAmerica/homebrew-tap`.
8. After merge, update Mintlify `scout/install` from source install to
   Homebrew-first install.

## Verification Commands

Run from the Atlas checkout before release:

```bash
cd scout
uv run pytest --no-cov tests/test_config.py tests/test_scraper/test_fetcher.py -q
uv run scout --help
uv run scout doctor --json
```

Run from the tap checkout before merge:

```bash
brew audit --strict --online Formula/atlas-scout.rb
brew install --build-from-source Formula/atlas-scout.rb
scout --help
scout doctor --json
brew uninstall atlas-scout
```
