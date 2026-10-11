"""Use zipimport for pure packages while keeping native libraries on the filesystem."""

import hashlib
import json
import shutil
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
