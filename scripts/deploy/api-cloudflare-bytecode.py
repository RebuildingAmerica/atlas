"""Precompile large unchanged classifier tables with the target Python minor."""

import argparse
import hashlib
import importlib.util
import json
import py_compile
import sys
from pathlib import Path


def compile_tables(vendor: Path) -> dict:
    """Avoid request-time compiler memory without changing classifier data."""
    if sys.version_info[:2] != (3, 14):
        raise ValueError("The pinned Python Worker requires Python 3.14 bytecode.")
    records = []
    for name in ("gender", "ratios"):
        source = vendor / "probablepeople" / f"{name}.py"
        target = source.with_suffix(".pyc")
        source_digest = hashlib.sha256(source.read_bytes()).hexdigest()
        py_compile.compile(
            str(source),
            cfile=str(target),
            dfile=f"/session/metadata/python_modules/probablepeople/{name}.py",
            doraise=True,
            optimize=0,
            invalidation_mode=py_compile.PycInvalidationMode.CHECKED_HASH,
        )
        records.append(
            {
                "module": f"probablepeople.{name}",
                "sourceSha256": source_digest,
                "bytecodeSha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            }
        )
        source.unlink()
    return {
        "python": sys.version.split()[0],
        "magic": importlib.util.MAGIC_NUMBER.hex(),
        "modules": records,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vendor", type=Path, required=True)
    parser.add_argument("--provenance", type=Path, required=True)
    args = parser.parse_args()
    args.provenance.write_text(json.dumps(compile_tables(args.vendor), indent=2) + "\n")
