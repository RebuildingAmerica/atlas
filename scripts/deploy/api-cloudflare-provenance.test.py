"""Verify current-source/archive/native provenance without network or credentials."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location(
    "provenance", Path(__file__).with_name("api-cloudflare-provenance.py")
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.vendor = self.root / "vendor"
        self.vendor.mkdir()
        self.native = self.root / "native.json"
        self.packages = self.root / "packages.json"
        self.native.write_text(
            json.dumps({"runId": "123", "headSha": "a" * 40, "packages": []})
        )
        (self.root / "api").mkdir()
        (self.root / "api/uv.lock").write_text("package = []\n")
        for folder, name in [
            ("api/atlas", "atlas"),
            ("libs/shared/src/atlas_shared", "atlas_shared"),
            (
                "libs/discovery-engine/src/atlas_discovery_engine",
                "atlas_discovery_engine",
            ),
        ]:
            source = self.root / folder
            source.mkdir(parents=True)
            (source / "__init__.py").write_text("# current code\n")
            # Atlas's own resources may be on disk while pure dependencies zipimport.
            (self.vendor / name).mkdir()
            (self.vendor / name / "__init__.py").write_bytes(
                (source / "__init__.py").read_bytes()
            )
        self.archive()

    def tearDown(self):
        self.temp.cleanup()

    def archive(self):
        record = {"files": {}}
        for filename, key, group in [
            ("core.zip", "coreSha256", "core"),
            ("packages.zip", "archiveSha256", "deferred"),
        ]:
            files = (
                {"package/data.txt": b"retained classifier data"}
                if group == "deferred"
                else {}
            )
            with zipfile.ZipFile(self.vendor / filename, "w") as output:
                for path, data in files.items():
                    output.writestr(path, data)
            record[key] = MODULE.sha((self.vendor / filename).read_bytes())
            record["files"][group] = [
                {"name": path, "sha256": MODULE.sha(data)}
                for path, data in files.items()
            ]
        self.packages.write_text(json.dumps(record))

    def verify(self, required=None):
        with patch.object(MODULE.subprocess, "run") as ancestry:
            result = MODULE.verify_provenance(
                vendor=self.vendor,
                native_file=self.native,
                packages_file=self.packages,
                root=self.root,
                required=set() if required is None else required,
            )
            self.assertEqual(
                ancestry.call_args.args[0][1:3], ["merge-base", "--is-ancestor"]
            )
            return result

    def test_retained_archives_and_exact_current_files_are_accepted(self):
        self.assertEqual(self.verify()["nativeRunId"], "123")

    def test_changed_or_removed_current_code_is_rejected(self):
        (self.vendor / "atlas/__init__.py").write_text("# old implementation\n")
        with self.assertRaisesRegex(ValueError, "current committed source"):
            self.verify()
        (self.vendor / "atlas/__init__.py").unlink()
        with self.assertRaisesRegex(ValueError, "current committed source"):
            self.verify()

    def test_archive_tamper_and_forged_package_records_are_rejected(self):
        (self.vendor / "packages.zip").write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "archive differs"):
            self.verify()
        self.archive()
        record = json.loads(self.packages.read_text())
        record["files"]["deferred"][0]["sha256"] = "0" * 64
        self.packages.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError, "files differ"):
            self.verify()

    def test_unexpected_native_package_identity_is_rejected(self):
        record = json.loads(self.native.read_text())
        record["packages"] = [
            {"name": "unreviewed", "version": "1", "sha256": "0" * 64}
        ]
        self.native.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError, "complete pinned"):
            self.verify()

    def test_installed_native_bytes_and_locked_version_are_verified(self):
        native_dir = self.root / "inflate64"
        native_dir.mkdir()
        wheel = (
            native_dir / "inflate64-1.0.4-cp314-cp314-pyemscripten_2026_0_wasm32.whl"
        )
        with zipfile.ZipFile(wheel, "w") as output:
            output.writestr("inflate64/module.so", b"reviewed wasm extension")
        (self.vendor / "inflate64").mkdir()
        installed = self.vendor / "inflate64/module.so"
        installed.write_bytes(b"reviewed wasm extension")
        (self.root / "api/uv.lock").write_text(
            '[[package]]\nname="inflate64"\nversion="1.0.4"\n'
        )
        self.native.write_text(
            json.dumps(
                {
                    "runId": "123",
                    "headSha": "a" * 40,
                    "packages": [
                        {
                            "name": "inflate64",
                            "version": "1.0.4",
                            "sha256": MODULE.sha(wheel.read_bytes()),
                        }
                    ],
                }
            )
        )
        self.assertEqual(self.verify({"inflate64"})["nativeRunId"], "123")
        installed.write_bytes(b"unreviewed replacement")
        with self.assertRaisesRegex(ValueError, "installed native extension"):
            self.verify({"inflate64"})


if __name__ == "__main__":
    unittest.main()
