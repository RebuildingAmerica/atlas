"""Use zipimport for pure packages while keeping native libraries on the filesystem."""

import hashlib
import importlib.util
import json
import py_compile
import shutil
import sys
import zipfile
from pathlib import Path

# These packages use importlib.resources for bundled data or contain Python only.
# Native extension packages and Atlas's own runtime files remain ordinary files.
PURE_PACKAGES = {
    "babel",
    "anthropic",
    "pytz",
    "dateparser",
    "dns",
    "mcp",
    "pydantic",
    "fastapi",
    "anyio",
    "httpx",
    "httpcore",
    "starlette",
    "jsonschema",
    "jsonschema_specifications",
    "referencing",
    "attr",
    "attrs",
    "urllib3",
    "nameparser",
    "pydantic_settings",
}

# The HTTP import graph must be available when Cloudflare snapshots the entry
# module. Extraction data stays deferred so browsing profiles does not load the
# classifier, locale tables, or document parser into the initial snapshot.
CORE_PACKAGES = {
    "anthropic",
    "anyio",
    "attr",
    "attrs",
    "fastapi",
    "httpcore",
    "httpx",
    "jsonschema",
    "jsonschema_specifications",
    "mcp",
    "nameparser",
    "pydantic",
    "pydantic_settings",
    "referencing",
    "starlette",
}

# CPython 3.14.2, used by the pinned Pyodide runtime. A future opcode/marshal
# change must fail the build rather than silently recompiling sources on visits.
TARGET_BYTECODE_MAGIC = bytes.fromhex("2b0e0d0a")


def check_bytecode_version() -> None:
    if sys.version_info[:2] != (3, 14):
        raise ValueError("The pinned Python Worker requires Python 3.14 bytecode.")
    if importlib.util.MAGIC_NUMBER != TARGET_BYTECODE_MAGIC:
        raise ValueError("Compiler bytecode does not match the pinned Python Worker.")


def compile_package_sources(vendor: Path) -> dict[str, object]:
    """Skip cold-request AST compilation while preserving inspectable sources.

    zipimport loads adjacent legacy `.pyc` files before `.py` files. Checked
    hashes invalidate stale code, and a stable virtual filename keeps identical
    source reproducible across build directories. Loaders still expose sources.
    """
    check_bytecode_version()
    records = []
    for directory in sorted(vendor.iterdir()):
        if directory.name not in PURE_PACKAGES or not directory.is_dir():
            continue
        for source in sorted(directory.rglob("*.py")):
            if "__pycache__" in source.parts:
                continue
            name = source.relative_to(vendor).as_posix()
            target = source.with_suffix(".pyc")
            data = source.read_bytes()
            py_compile.compile(
                str(source),
                cfile=str(target),
                dfile=f"/session/metadata/python_modules/{name}",
                doraise=True,
                optimize=0,
                invalidation_mode=py_compile.PycInvalidationMode.CHECKED_HASH,
            )
            records.append(
                {
                    "name": name,
                    "sourceSha256": hashlib.sha256(data).hexdigest(),
                    "bytecodeSha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                }
            )
    return {
        "python": sys.version.split()[0],
        "magic": importlib.util.MAGIC_NUMBER.hex(),
        "modules": records,
    }


def archive_packages(vendor: Path) -> dict[str, object]:
    """Preserve package bytes while reducing upload parts and lazy import memory."""
    archive = vendor / "packages.zip"
    directories = [
        path
        for path in vendor.iterdir()
        if path.is_dir()
        and (path.name in PURE_PACKAGES or path.name.endswith(".dist-info"))
    ]
    records = []
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as target:
        for directory in sorted(directories):
            for path in sorted(directory.rglob("*")):
                if path.is_file() and "__pycache__" not in path.parts:
                    data = path.read_bytes()
                    name = path.relative_to(vendor).as_posix()
                    if path.suffix == ".pyc" and (
                        len(data) < 16
                        or data[:4] != TARGET_BYTECODE_MAGIC
                        or int.from_bytes(data[4:8], "little") != 3
                    ):
                        raise ValueError(
                            "Archived bytecode must match the pinned checked-hash format."
                        )
                    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o644 << 16
                    target.writestr(info, data)
                    records.append(
                        {"name": name, "sha256": hashlib.sha256(data).hexdigest()}
                    )
    with zipfile.ZipFile(archive) as source:
        for item in records:
            if hashlib.sha256(source.read(item["name"])).hexdigest() != item["sha256"]:
                raise ValueError("Archived package bytes differ from the source.")
    for directory in directories:
        shutil.rmtree(directory)
    return {
        "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "files": records,
    }


def partition_core_archive(vendor: Path) -> dict[str, object]:
    """Split the verified archive without changing or duplicating package bytes."""
    archive = vendor / "packages.zip"
    core = vendor / "core.zip"
    if core.exists():
        raise ValueError("Core partition requires an unpartitioned package archive.")
    deferred = vendor / "packages-deferred.zip"
    records = {"core": [], "deferred": []}
    written_directories = {"core": set(), "deferred": set()}
    try:
        with (
            zipfile.ZipFile(archive) as source,
            zipfile.ZipFile(core, "w") as bundled,
            zipfile.ZipFile(deferred, "w") as assets,
        ):
            for info in sorted(source.infolist(), key=lambda info: info.filename):
                package = info.filename.split("/", 1)[0]
                is_core = package in CORE_PACKAGES or package.endswith(".dist-info")
                destination = bundled if is_core else assets
                kind = "core" if is_core else "deferred"
                # zipimport needs explicit directory records for namespace
                # packages such as anthropic._decoders (no __init__.py).
                parts = info.filename.split("/")
                for index in range(1, len(parts)):
                    directory = "/".join(parts[:index]) + "/"
                    if directory not in written_directories[kind]:
                        entry = zipfile.ZipInfo(
                            directory, date_time=(1980, 1, 1, 0, 0, 0)
                        )
                        entry.external_attr = (0o40755 << 16) | 0x10
                        destination.writestr(entry, b"")
                        written_directories[kind].add(directory)
                data = source.read(info)
                destination.writestr(info, data)
                records[kind].append(
                    {"name": info.filename, "sha256": hashlib.sha256(data).hexdigest()}
                )
        result = {
            "coreSha256": hashlib.sha256(core.read_bytes()).hexdigest(),
            "archiveSha256": hashlib.sha256(deferred.read_bytes()).hexdigest(),
            "files": records,
        }
        deferred.replace(archive)
        return result
    except BaseException:
        core.unlink(missing_ok=True)
        deferred.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vendor", required=True, type=Path)
    parser.add_argument("--provenance", required=True, type=Path)
    parser.add_argument("--partition-existing", action="store_true")
    args = parser.parse_args()
    if not args.partition_existing:
        archive_packages(args.vendor)
    args.provenance.write_text(
        json.dumps(partition_core_archive(args.vendor), indent=2) + "\n"
    )
