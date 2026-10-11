"""Compress all Babel locales losslessly to fit the hosted API upload limit."""

import gzip
import hashlib
import json
from pathlib import Path


def compress_locales(vendor: Path) -> dict[str, object]:
    """Keep every locale and load only the requested locale into memory."""
    source = vendor / "babel/localedata.py"
    code = source.read_text()
    replacements = {
        "import os\n": "import gzip\nimport os\n",
        'f"{name}.dat"': 'f"{name}.dat.gz"',
        "os.path.splitext(filename) for filename in os.listdir(_dirname)": 'os.path.splitext(filename.removesuffix(".gz")) for filename in os.listdir(_dirname)',
        "with open(filename, 'rb') as fileobj:": "with gzip.open(filename, 'rb') as fileobj:",
    }
    for before, after in replacements.items():
        if code.count(before) != 1:
            raise ValueError(
                "Babel locale loader changed; review compression compatibility."
            )
        code = code.replace(before, after)
    records = []
    for path in sorted((vendor / "babel/locale-data").glob("*.dat")):
        original = path.read_bytes()
        compressed = gzip.compress(original, mtime=0)
        if gzip.decompress(compressed) != original:
            raise ValueError("Locale compression did not preserve the source bytes.")
        path.with_suffix(".dat.gz").write_bytes(compressed)
        path.unlink()
        records.append(
            {
                "name": path.name,
                "sha256": hashlib.sha256(original).hexdigest(),
                "bytes": len(original),
                "compressedBytes": len(compressed),
            }
        )
    if not records:
        raise ValueError("A fresh complete Babel locale set is required.")
    source.write_text(code)
    return {
        "locales": records,
        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vendor", required=True, type=Path)
    parser.add_argument("--provenance", required=True, type=Path)
    args = parser.parse_args()
    args.provenance.write_text(
        json.dumps(compress_locales(args.vendor), indent=2) + "\n"
    )
