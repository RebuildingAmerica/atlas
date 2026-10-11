"""Archived packages retain imports, resources, metadata, and reproducible bytes."""

import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "packages", Path(__file__).with_name("api-cloudflare-packages.py")
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PackageArchiveTests(unittest.TestCase):
    def test_import_resources_metadata_and_native_library_separation(self):
        digests = []
        for _ in range(2):
            with tempfile.TemporaryDirectory() as directory:
                vendor = Path(directory)
                package = vendor / "anthropic"
                package.mkdir()
                (package / "__init__.py").write_text(
                    'from importlib.resources import files\ndef evidence():\n    return files(__package__).joinpath("evidence.json").read_text()\n'
                )
                (package / "evidence.json").write_text('{"source":"preserved"}')
                native = vendor / "asyncpg"
                native.mkdir()
                (native / "protocol.so").write_bytes(b"native-library")
                metadata = vendor / "atlas_runtime_test-1.0.dist-info"
                metadata.mkdir()
                (metadata / "METADATA").write_text(
                    "Metadata-Version: 2.1\nName: atlas-runtime-test\nVersion: 1.0\n"
                )
                provenance = MODULE.archive_packages(vendor)
                output = subprocess.check_output(
                    [
                        "python3",
                        "-c",
                        'import anthropic,importlib.metadata,json; print(json.dumps([json.loads(anthropic.evidence()),importlib.metadata.version("atlas-runtime-test")]))',
                    ],
                    cwd=directory,
                    env={**os.environ, "PYTHONPATH": str(vendor / "packages.zip")},
                )
                self.assertEqual(json.loads(output), [{"source": "preserved"}, "1.0"])
                self.assertEqual(
                    (native / "protocol.so").read_bytes(), b"native-library"
                )
                self.assertFalse(package.exists())
                digests.append(provenance["archiveSha256"])
        self.assertEqual(*digests)


if __name__ == "__main__":
    unittest.main()
