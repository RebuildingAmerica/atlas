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


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vendor", required=True, type=Path)
    parser.add_argument("--provenance", required=True, type=Path)
    args = parser.parse_args()
    args.provenance.write_text(
        json.dumps(archive_packages(args.vendor), indent=2) + "\n"
    )
