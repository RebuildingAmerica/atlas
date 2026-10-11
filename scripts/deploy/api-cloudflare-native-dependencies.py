"""Install verified native evaluation wheels without changing Atlas versions."""

import argparse
import hashlib
import json
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


def install_native_packages(run_id: str) -> None:
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
    packages = {
        item["name"]: item for item in lock["package"] if item["name"] in PACKAGES
    }
    artifact_root = ROOT / ".atlas/python-native-evaluation" / run_id
    artifact_root.mkdir(parents=True, exist_ok=True)
    requirements = []
    identities = []
    for name in sorted(PACKAGES):
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
            filename = f"{name.replace('-', '_')}-{version}-cp314-cp314-pyemscripten_2026_0_wasm32.whl"
            path = destination / filename
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
    requirements_file = artifact_root / "requirements.txt"
    requirements_file.write_text("\n".join(requirements) + "\n")
    subprocess.run(
        ["python3", str(ROOT / "scripts/deploy/api-cloudflare-dependencies.py")],
        check=True,
    )
    subprocess.run(
        [
            "uv",
            "pip",
            "install",
            "--python",
            "cpython-3.14.2-emscripten-wasm32-musl",
            "--target",
            str(
                ROOT
                / ".atlas/python-compatibility-dependencies/lib/python3.14/site-packages"
            ),
            "--no-deps",
            "--require-hashes",
            "--requirements",
            str(requirements_file),
        ],
        check=True,
    )
    (artifact_root / "provenance.json").write_text(
        json.dumps(
            {"runId": run_id, "headSha": run["headSha"], "packages": identities},
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True)
    install_native_packages(parser.parse_args().run)
