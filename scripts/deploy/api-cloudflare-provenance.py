#!/usr/bin/env python3
"""Verify retained native build artifacts and current Atlas package bytes offline."""

import argparse
import hashlib
import json
import re
from pathlib import Path
import subprocess
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parents[2]
NATIVE_PACKAGES = {
    "inflate64",
    "python-crfsuite",
    "doublemetaphone",
    "probablepeople",
    "probableparsing",
    "pydantic-core",
    "lxml",
    "cryptography",
    "jiter",
    "rpds-py",
    "regex",
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def verify_provenance(
    *, vendor, native_file, packages_file, root=ROOT, required=NATIVE_PACKAGES
):
    native = json.loads(native_file.read_text())
    package_record = json.loads(packages_file.read_text())
    versions = {
        item["name"]: item
        for item in tomllib.loads((root / "api/uv.lock").read_text())["package"]
    }
    if not str(native.get("runId", "")).isdecimal() or not re.fullmatch(
        r"[a-f0-9]{40}", native.get("headSha", "")
    ):
        raise ValueError("An exact retained native workflow identity is required.")
    subprocess.run(
        ["git", "merge-base", "--is-ancestor", native["headSha"], "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
    )
    rows = {item["name"]: item for item in native.get("packages", [])}
    if set(rows) != required or len(rows) != len(native["packages"]):
        raise ValueError(
            "The complete pinned API native package provenance is required."
        )
    contents = {}
    for name, digest_key, group in [
        ("core.zip", "coreSha256", "core"),
        ("packages.zip", "archiveSha256", "deferred"),
    ]:
        archive = vendor / name
        if sha(archive.read_bytes()) != package_record[digest_key]:
            raise ValueError("A package archive differs from its retained provenance.")
        expected = {
            item["name"]: item["sha256"] for item in package_record["files"][group]
        }
        if len(expected) != len(package_record["files"][group]):
            raise ValueError("Package provenance contains duplicate records.")
        with zipfile.ZipFile(archive) as source:
            actual = {}
            for info in source.infolist():
                if info.is_dir():
                    continue
                if (
                    info.filename in contents
                    or info.filename in actual
                    or info.filename.startswith("/")
                    or ".." in Path(info.filename).parts
                ):
                    raise ValueError(
                        "Package archives contain unsafe or duplicate paths."
                    )
                data = source.read(info)
                actual[info.filename] = sha(data)
                contents[info.filename] = data
            if actual != expected:
                raise ValueError("Archived files differ from retained provenance.")
    # cffi is built in the cryptography recipe, rather than a separate workflow
    # artifact. Its exact locked wheel and reviewed checksum are required too.
    cffi_digest = None
    if "cryptography" in required:
        cffi = versions["cffi"]
        wheel = (
            native_file.parent
            / "cryptography"
            / f"cffi-{cffi['version']}-cp314-cp314-pyemscripten_2026_0_wasm32.whl"
        )
        cffi_digest = sha(wheel.read_bytes())
        checksums = (wheel.parent / "SHA256SUMS").read_text().splitlines()
        if not any(
            line.split()[0] == cffi_digest and Path(line.split()[1]).name == wheel.name
            for line in checksums
        ):
            raise ValueError(
                "The retained cffi wheel differs from its reviewed checksum."
            )
        rows["cffi"] = {"version": cffi["version"], "sha256": cffi_digest}
    for name, row in rows.items():
        if row["version"] != versions[name]["version"]:
            raise ValueError(
                "A native dependency differs from the current locked version."
            )
        if name in {"probablepeople", "probableparsing"}:
            if not any(
                wheel["hash"] == "sha256:" + row["sha256"]
                for wheel in versions[name]["wheels"]
            ):
                raise ValueError(
                    "A pure dependency differs from its locked wheel hash."
                )
            continue
        wheels = list(
            native_file.parent.joinpath(
                "cryptography" if name == "cffi" else name
            ).glob("*-cp314-*-pyemscripten_2026_0_wasm32.whl")
        )
        wheels = [wheel for wheel in wheels if sha(wheel.read_bytes()) == row["sha256"]]
        if len(wheels) != 1:
            raise ValueError("A retained native wheel does not match its provenance.")
        with zipfile.ZipFile(wheels[0]) as wheel:
            for member in wheel.namelist():
                if not member.endswith(".so"):
                    continue
                installed = contents.get(member)
                if installed is None:
                    installed = vendor.joinpath(member).read_bytes()
                if sha(installed) != sha(wheel.read(member)):
                    raise ValueError(
                        "An installed native extension differs from its reviewed wheel."
                    )
    for folder, package in [
        ("api/atlas", "atlas"),
        ("libs/shared/src/atlas_shared", "atlas_shared"),
        ("libs/discovery-engine/src/atlas_discovery_engine", "atlas_discovery_engine"),
    ]:
        source_root = root / folder
        expected = {}
        for path in sorted(source_root.rglob("*")):
            if (
                not path.is_file()
                or "__pycache__" in path.parts
                or path.suffix == ".pyc"
            ):
                continue
            key = package + "/" + path.relative_to(source_root).as_posix()
            expected[key] = path.read_bytes()
        actual = {
            key: data
            for key, data in contents.items()
            if key.startswith(package + "/")
            and not key.endswith(".pyc")
            and not key.startswith("atlas/platform/mcp/_widget_assets/")
        }
        # Non-archived resources remain supported; compare their exact bytes too.
        for path in vendor.joinpath(package).rglob("*"):
            if (
                path.is_file()
                and path.suffix != ".pyc"
                and "__pycache__" not in path.parts
                and "_widget_assets" not in path.parts
            ):
                actual[path.relative_to(vendor).as_posix()] = path.read_bytes()
        if actual != expected:
            raise ValueError(
                "Vendored Atlas code/resources differ from the current committed source; rebuild the vendor archives."
            )
    return {
        "schemaVersion": 1,
        "nativeRunId": str(native["runId"]),
        "nativeBuildSha": native["headSha"],
        "nativeProvenanceDigest": sha(native_file.read_bytes()),
        "packageProvenanceDigest": sha(packages_file.read_bytes()),
        "coreSha256": package_record["coreSha256"],
        "packagesSha256": package_record["archiveSha256"],
        "cffiWheelDigest": cffi_digest,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vendor", required=True, type=Path)
    parser.add_argument("--native-provenance", required=True, type=Path)
    parser.add_argument("--packages-provenance", required=True, type=Path)
    args = parser.parse_args()
    try:
        print(
            json.dumps(
                verify_provenance(
                    vendor=args.vendor,
                    native_file=args.native_provenance,
                    packages_file=args.packages_provenance,
                )
            )
        )
    except Exception:
        parser.exit(
            1,
            "Offline package provenance verification failed; rebuild current sources with the retained reviewed native wheels.\n",
        )
