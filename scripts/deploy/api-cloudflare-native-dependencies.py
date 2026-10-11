"""Install verified native evaluation wheels without changing Atlas versions."""

import argparse
import hashlib
import json
import shutil
import subprocess
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACKAGES = {
    "inflate64",
    "python-crfsuite",
    "doublemetaphone",
    "probablepeople",
    "probableparsing",
}


def install_native_packages(run_id: str, *, full_api: bool = False) -> None:
    """Verify repository build provenance and wheel hashes before installation."""
    if not run_id.isdecimal():
        raise ValueError("A numeric GitHub Actions run ID is required.")
    run = json.loads(
        subprocess.check_output(
            [
                "gh",
                "run",
                "view",
                run_id,
                "--repo",
                "RebuildingAmerica/atlas",
                "--json",
                "name,headSha,status",
            ]
        )
    )
    if run["name"] != "Build Cloudflare Python wheels" or run["status"] != "completed":
        raise ValueError("A completed Atlas native-wheel workflow is required.")
    subprocess.run(
        ["git", "merge-base", "--is-ancestor", run["headSha"], "HEAD"],
        cwd=ROOT,
        check=True,
    )
    lock = tomllib.loads((ROOT / "api/uv.lock").read_text())
    names = PACKAGES | (
        {"pydantic-core", "lxml", "cryptography", "jiter", "rpds-py", "regex"}
        if full_api
        else set()
    )
    packages = {item["name"]: item for item in lock["package"] if item["name"] in names}
    artifact_root = ROOT / ".atlas/python-native-evaluation" / run_id
    artifact_root.mkdir(parents=True, exist_ok=True)
    requirements = []
    identities = []
    for name in sorted(names):
        package = packages[name]
        version = package["version"]
        if name in {"probablepeople", "probableparsing"}:
            wheel = next(
                item
                for item in package["wheels"]
                if item["url"].endswith("none-any.whl")
            )
            url, digest = wheel["url"], wheel["hash"].removeprefix("sha256:")
        else:
            destination = artifact_root / name
            if not destination.exists():
                subprocess.run(
                    [
                        "gh",
                        "run",
                        "download",
                        run_id,
                        "--repo",
                        "RebuildingAmerica/atlas",
                        "--name",
                        f"pyodide-{name}=={version}",
                        "--dir",
                        str(destination),
                    ],
                    check=True,
                )
            wheels = list(
                destination.glob(
                    f"{name.replace('-', '_')}-{version}-cp314-*-pyemscripten_2026_0_wasm32.whl"
                )
            )
            if len(wheels) != 1:
                raise ValueError("Exactly one compatible native wheel is required.")
            path = wheels[0]
            entries = {
                Path(filename).name: digest
                for digest, filename in (
                    line.split()
                    for line in (destination / "SHA256SUMS").read_text().splitlines()
                )
            }
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if entries.get(path.name) != digest:
                raise ValueError(
                    "A native wheel does not match its build artifact hash."
                )
            url = path.as_uri()
        requirements.append(f"{name} @ {url} --hash=sha256:{digest}")
        identities.append({"name": name, "version": version, "sha256": digest})
    vendor = ROOT / (
        ".atlas/python-api-dependencies"
        if full_api
        else ".atlas/python-compatibility-dependencies/lib/python3.14/site-packages"
    )
    if full_api:
        excluded = names | {
            "psycopg",
            "psycopg-binary",
            "uvicorn",
            "uvloop",
            "httptools",
            "watchfiles",
            "websockets",
            "pyyaml",
            "cffi",
        }
        exported = subprocess.check_output(
            [
                "uv",
                "export",
                "--locked",
                "--no-dev",
                "--no-emit-project",
                "--no-emit-local",
                "--no-header",
                "--no-annotate",
                *[
                    arg
                    for name in sorted(excluded)
                    for arg in ("--no-emit-package", name)
                ],
            ],
            cwd=ROOT / "api",
            text=True,
        )
        requirements.insert(0, exported)
        # cffi's exact locked version is included in the pinned recipe build.
        cffi_version = next(
            item["version"] for item in lock["package"] if item["name"] == "cffi"
        )
        crypto_dir = artifact_root / "cryptography"
        cffi_path = (
            crypto_dir
            / f"cffi-{cffi_version}-cp314-cp314-pyemscripten_2026_0_wasm32.whl"
        )
        cffi_hash = hashlib.sha256(cffi_path.read_bytes()).hexdigest()
        if not any(
            line.split()[0] == cffi_hash
            and Path(line.split()[1]).name == cffi_path.name
            for line in (crypto_dir / "SHA256SUMS").read_text().splitlines()
        ):
            raise ValueError("The cffi artifact hash does not match its build.")
        requirements.append(f"cffi @ {cffi_path.as_uri()} --hash=sha256:{cffi_hash}")
        baseline = tomllib.loads(
            (ROOT / "services/api-cloudflare/compatibility/pylock.toml").read_text()
        )
        for item in baseline["packages"]:
            if item["name"] in {"asyncpg", "workers-runtime-sdk", "opentelemetry-api"}:
                wheel = item["wheels"][0]
                requirements.append(
                    f"{item['name']} @ {wheel['url']} --hash=sha256:{wheel['hashes']['sha256']}"
                )
        # This fixed directory contains only generated build artifacts. Rebuild
        # it so removed source files and transformed vendor data cannot persist.
        if vendor.exists():
            shutil.rmtree(vendor)
        vendor.mkdir(parents=True, exist_ok=True)
    else:
        subprocess.run(
            ["python3", str(ROOT / "scripts/deploy/api-cloudflare-dependencies.py")],
            check=True,
        )
    requirements_file = artifact_root / (
        "api-requirements.txt" if full_api else "requirements.txt"
    )
    requirements_file.write_text("\n".join(requirements) + "\n")
    subprocess.run(
        [
            "uv",
            "pip",
            "sync" if full_api else "install",
            "--python",
            "cpython-3.14.2-emscripten-wasm32-musl",
            "--target",
            str(vendor),
            *(["--only-binary", ":all:"] if full_api else ["--no-deps"]),
            "--require-hashes",
            *([] if full_api else ["--requirements"]),
            str(requirements_file),
        ],
        check=True,
    )
    if full_api:
        # MCP clients must retain the same usable profile widgets as Node hosts.
        subprocess.run(
            ["pnpm", "--filter", "@rebuildingamerica/entity-widgets-mcp...", "build"],
            cwd=ROOT,
            check=True,
        )
        for source, name in (
            (ROOT / "api/atlas", "atlas"),
            (ROOT / "libs/shared/src/atlas_shared", "atlas_shared"),
            (
                ROOT / "libs/discovery-engine/src/atlas_discovery_engine",
                "atlas_discovery_engine",
            ),
        ):
            shutil.copytree(
                source,
                vendor / name,
                dirs_exist_ok=True,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
            )
        shutil.copytree(
            ROOT / "packages/entity-widgets-mcp/dist/widget",
            vendor / "atlas/platform/mcp/_widget_assets",
        )
        (vendor / "pyvenv.cfg").touch()
        subprocess.run(
            [
                "python3",
                str(ROOT / "scripts/deploy/api-cloudflare-locales.py"),
                "--vendor",
                str(vendor),
                "--provenance",
                str(artifact_root / "locale-provenance.json"),
            ],
            check=True,
        )
    (
        artifact_root / ("api-provenance.json" if full_api else "provenance.json")
    ).write_text(
        json.dumps(
            {"runId": run_id, "headSha": run["headSha"], "packages": identities},
            indent=2,
        )
        + "\n"
    )
    subprocess.run(
        [
            "uv",
            "run",
            "--no-project",
            "--python",
            "3.14",
            "python",
            str(ROOT / "scripts/deploy/api-cloudflare-bytecode.py"),
            "--vendor",
            str(vendor),
            "--provenance",
            str(
                artifact_root
                / (
                    "api-bytecode-provenance.json"
                    if full_api
                    else "bytecode-provenance.json"
                )
            ),
        ],
        check=True,
    )

    if full_api:
        subprocess.run(
            [
                "python3",
                str(ROOT / "scripts/deploy/api-cloudflare-packages.py"),
                "--vendor",
                str(vendor),
                "--provenance",
                str(artifact_root / "packages-provenance.json"),
            ],
            check=True,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True)
    parser.add_argument("--full-api", action="store_true")
    args = parser.parse_args()
    install_native_packages(args.run, full_api=args.full_api)
