"""Archived packages retain imports, resources, metadata, and reproducible bytes."""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "packages", Path(__file__).with_name("api-cloudflare-packages.py")
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def archive_files(vendor):
    files = {}
    for archive in ("core.zip", "packages.zip"):
        with zipfile.ZipFile(vendor / archive) as source:
            files.update(
                (item.filename, source.read(item))
                for item in source.infolist()
                if not item.is_dir()
            )
    return files


class PackageArchiveTests(unittest.TestCase):
    def test_core_partition_retains_all_bytes_and_deferred_resources(self):
        digests = []
        for _ in range(2):
            with tempfile.TemporaryDirectory() as directory:
                vendor = Path(directory)
                for name in ("anthropic", "babel", "dns"):
                    package = vendor / name
                    package.mkdir()
                    (package / "__init__.py").write_text(
                        "from importlib.resources import files\ndef evidence():\n"
                        '    return files(__package__).joinpath("data.txt").read_text()\n'
                    )
                    (package / "data.txt").write_text(name)
                metadata = vendor / "atlas_runtime_test-1.0.dist-info"
                namespace = vendor / "anthropic/namespace"
                namespace.mkdir()
                (namespace / "value.py").write_text("VALUE = 7\n")
                metadata.mkdir()
                (metadata / "METADATA").write_text(
                    "Metadata-Version: 2.1\nName: atlas-runtime-test\nVersion: 1.0\n"
                )
                MODULE.archive_packages(vendor)
                with zipfile.ZipFile(vendor / "packages.zip") as original:
                    before = {name: original.read(name) for name in original.namelist()}
                result = MODULE.partition_core_archive(vendor)
                with zipfile.ZipFile(vendor / "core.zip") as core:
                    core_files = {
                        item.filename: core.read(item)
                        for item in core.infolist()
                        if not item.is_dir()
                    }
                with zipfile.ZipFile(vendor / "packages.zip") as deferred:
                    deferred_files = {
                        item.filename: deferred.read(item)
                        for item in deferred.infolist()
                        if not item.is_dir()
                    }
                self.assertEqual(set(core_files) & set(deferred_files), set())
                self.assertEqual(core_files | deferred_files, before)
                self.assertIn("anthropic/__init__.py", core_files)
                self.assertIn("dns/__init__.py", core_files)
                self.assertIn("babel/data.txt", deferred_files)
                core_output = subprocess.check_output(
                    [
                        sys.executable,
                        "-S",
                        "-c",
                        "import dns; print(dns.evidence())",
                    ],
                    cwd=directory,
                    env={**os.environ, "PYTHONPATH": str(vendor / "core.zip")},
                )
                self.assertEqual(core_output.strip(), b"dns")
                output = subprocess.check_output(
                    [
                        sys.executable,
                        "-c",
                        'import anthropic,babel,importlib.metadata,json; from anthropic.namespace.value import VALUE; print(json.dumps([anthropic.evidence(),babel.evidence(),importlib.metadata.version("atlas-runtime-test"),VALUE]))',
                    ],
                    cwd=directory,
                    env={
                        **os.environ,
                        "PYTHONPATH": os.pathsep.join(
                            str(vendor / name) for name in ("core.zip", "packages.zip")
                        ),
                    },
                )
                self.assertEqual(json.loads(output), ["anthropic", "babel", "1.0", 7])
                digests.append(result)
        self.assertEqual(*digests)

    def test_repartition_existing_pair_preserves_bytes_and_is_reproducible(self):
        with tempfile.TemporaryDirectory() as directory:
            vendor = Path(directory)
            for name in ("dns", "babel", "anthropic"):
                package = vendor / name
                package.mkdir()
                (package / "__init__.py").write_text(f"VALUE = {name!r}\n")
            MODULE.archive_packages(vendor)
            with patch.object(MODULE, "CORE_PACKAGES", {"anthropic"}):
                MODULE.partition_core_archive(vendor)
            with zipfile.ZipFile(vendor / "packages.zip") as deferred:
                self.assertIn("dns/__init__.py", deferred.namelist())
            before = archive_files(vendor)
            provenance = MODULE.partition_core_archive(vendor, repartition=True)
            with zipfile.ZipFile(vendor / "core.zip") as core:
                self.assertIn("dns/__init__.py", core.namelist())
            after = archive_files(vendor)
            self.assertEqual(before, after)
            self.assertEqual(
                MODULE.partition_core_archive(vendor, repartition=True), provenance
            )

    def test_failed_repartition_retains_existing_archives(self):
        with tempfile.TemporaryDirectory() as directory:
            vendor = Path(directory)
            core = vendor / "core.zip"
            with zipfile.ZipFile(core, "w") as archive:
                archive.writestr("anthropic/__init__.py", b"VALUE = 7\n")
            deferred = vendor / "packages.zip"
            deferred.write_bytes(b"invalid archive")
            before = (core.read_bytes(), deferred.read_bytes())
            with self.assertRaises(zipfile.BadZipFile):
                MODULE.partition_core_archive(vendor, repartition=True)
            self.assertEqual((core.read_bytes(), deferred.read_bytes()), before)

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

    @unittest.skipUnless(sys.version_info[:2] == (3, 14), "Requires target Python 3.14")
    def test_source_retaining_bytecode_avoids_compiler_and_preserves_introspection(
        self,
    ):
        with tempfile.TemporaryDirectory() as directory:
            vendor = Path(directory)
            package = vendor / "anthropic"
            package.mkdir()
            source = 'def evidence():\n    """Public source survives packaging."""\n    return "preserved"\n'
            (package / "__init__.py").write_text(source)
            (package / "evidence.json").write_text('{"source":"preserved"}')
            nested = package / "nested"
            nested.mkdir()
            (nested / "__init__.py").write_text("from .value import VALUE\n")
            (nested / "value.py").write_text("VALUE = 7\n")
            metadata = vendor / "atlas_runtime_test-1.0.dist-info"
            metadata.mkdir()
            (metadata / "METADATA").write_text(
                "Metadata-Version: 2.1\nName: atlas-runtime-test\nVersion: 1.0\n"
            )
            self.assertTrue(
                hasattr(MODULE, "compile_package_sources"), "Precompiler is missing"
            )
            MODULE.compile_package_sources(vendor)
            self.assertEqual((package / "__init__.py").read_text(), source)
            MODULE.archive_packages(vendor)
            script = """
import builtins, importlib.metadata, importlib.resources, inspect, json
original = builtins.compile
def forbidden_compile(*args, **kwargs):
    raise AssertionError("Zip import unexpectedly compiled source")
builtins.compile = forbidden_compile
import anthropic, anthropic.nested
builtins.compile = original
print(json.dumps({
    "value": anthropic.evidence(),
    "nested": anthropic.nested.VALUE,
    "source": inspect.getsource(anthropic.evidence),
    "module_source": inspect.getsource(anthropic),
    "resource": json.loads(importlib.resources.files(anthropic).joinpath("evidence.json").read_text()),
    "metadata": importlib.metadata.version("atlas-runtime-test"),
    "loader_source": anthropic.__loader__.get_source("anthropic"),
    "filename": anthropic.__file__,
}))
"""
            output = subprocess.check_output(
                [sys.executable, "-c", script],
                cwd=directory,
                env={**os.environ, "PYTHONPATH": str(vendor / "packages.zip")},
            )
            result = json.loads(output)
            self.assertEqual(result["value"], "preserved")
            self.assertEqual(result["nested"], 7)
            self.assertEqual(result["source"], source)
            self.assertEqual(result["module_source"], source)
            self.assertEqual(result["loader_source"], source)
            self.assertEqual(result["resource"], {"source": "preserved"})
            self.assertEqual(result["metadata"], "1.0")
            self.assertTrue(result["filename"].endswith("anthropic/__init__.pyc"))

    @unittest.skipUnless(sys.version_info[:2] == (3, 14), "Requires target Python 3.14")
    def test_checked_bytecode_and_archive_are_reproducible_across_build_paths(self):
        results = []
        for timestamp in (1000000000, 1800000000):
            with tempfile.TemporaryDirectory() as directory:
                vendor = Path(directory)
                package = vendor / "anthropic"
                package.mkdir()
                source = package / "__init__.py"
                source.write_text("VALUE = 7\n")
                os.utime(source, (timestamp, timestamp))
                self.assertTrue(
                    hasattr(MODULE, "compile_package_sources"), "Precompiler is missing"
                )
                compilation = MODULE.compile_package_sources(vendor)
                bytecode = source.with_suffix(".pyc").read_bytes()
                self.assertEqual(bytecode[:4], importlib.util.MAGIC_NUMBER)
                self.assertEqual(int.from_bytes(bytecode[4:8], "little"), 3)
                self.assertEqual(
                    bytecode[8:16], importlib.util.source_hash(source.read_bytes())
                )
                self.assertEqual(
                    compilation["modules"][0]["name"], "anthropic/__init__.py"
                )
                archive = MODULE.archive_packages(vendor)
                with zipfile.ZipFile(vendor / "packages.zip") as packaged:
                    self.assertEqual(
                        packaged.read("anthropic/__init__.py"), b"VALUE = 7\n"
                    )
                    self.assertEqual(packaged.read("anthropic/__init__.pyc"), bytecode)
                results.append((bytecode, compilation, archive))
        self.assertEqual(*results)

    def test_compilation_rejects_incompatible_python_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            vendor = Path(directory)
            package = vendor / "anthropic"
            package.mkdir()
            (package / "__init__.py").write_text("VALUE = 7\n")
            self.assertTrue(
                hasattr(MODULE, "compile_package_sources"), "Precompiler is missing"
            )
            with patch.object(sys, "version_info", (3, 13, 0)):
                with self.assertRaisesRegex(ValueError, "Python 3.14"):
                    MODULE.compile_package_sources(vendor)
            self.assertFalse((package / "__init__.pyc").exists())
            self.assertTrue((package / "__init__.py").exists())

    def test_archive_rejects_wrong_bytecode_without_removing_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            vendor = Path(directory)
            package = vendor / "anthropic"
            package.mkdir()
            (package / "__init__.py").write_text("VALUE = 7\n")
            (package / "__init__.pyc").write_bytes(b"wrong-bytecode-magic")
            with self.assertRaisesRegex(ValueError, "bytecode"):
                MODULE.archive_packages(vendor)
            self.assertTrue((package / "__init__.py").is_file())

    @unittest.skipUnless(sys.version_info[:2] == (3, 14), "Requires target Python 3.14")
    def test_changed_source_invalidates_checked_bytecode(self):
        with tempfile.TemporaryDirectory() as directory:
            vendor = Path(directory)
            package = vendor / "anthropic"
            package.mkdir()
            source = package / "__init__.py"
            source.write_text("VALUE = 7\n")
            MODULE.compile_package_sources(vendor)
            source.write_text("VALUE = 9\n")
            MODULE.archive_packages(vendor)
            output = subprocess.check_output(
                [sys.executable, "-c", "import anthropic; print(anthropic.VALUE)"],
                cwd=directory,
                env={**os.environ, "PYTHONPATH": str(vendor / "packages.zip")},
            )
            self.assertEqual(output.strip(), b"9")

    @unittest.skipUnless(sys.version_info[:2] == (3, 14), "Requires target Python 3.14")
    def test_existing_bytecode_build_step_compiles_packages_and_classifier_tables(self):
        with tempfile.TemporaryDirectory() as directory:
            vendor = Path(directory)
            package = vendor / "anthropic"
            package.mkdir()
            (package / "__init__.py").write_text("VALUE = 7\n")
            tables = vendor / "probablepeople"
            tables.mkdir()
            for name in ("gender", "ratios"):
                (tables / f"{name}.py").write_text('TABLE = {"preserved": 7}\n')
            provenance = vendor / "bytecode-provenance.json"
            subprocess.check_call(
                [
                    sys.executable,
                    str(Path(__file__).with_name("api-cloudflare-bytecode.py")),
                    "--vendor",
                    str(vendor),
                    "--provenance",
                    str(provenance),
                ]
            )
            result = json.loads(provenance.read_text())
            self.assertEqual(len(result["modules"]), 2)
            self.assertEqual(len(result["packages"]["modules"]), 1)
            self.assertTrue((package / "__init__.py").is_file())
            self.assertTrue((package / "__init__.pyc").is_file())
            for name in ("gender", "ratios"):
                self.assertFalse((tables / f"{name}.py").exists())
                self.assertTrue((tables / f"{name}.pyc").is_file())

    @unittest.skipUnless(sys.version_info[:2] == (3, 14), "Requires target Python 3.14")
    def test_archive_hash_is_stable_across_process_hash_seeds(self):
        results = []
        compiler = Path(__file__).with_name("api-cloudflare-packages.py").resolve()
        script = """
import importlib.util,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location("packages",sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
vendor=Path(sys.argv[2]);module.compile_package_sources(vendor)
print(module.archive_packages(vendor)["archiveSha256"])
"""
        for seed in ("1", "2"):
            with tempfile.TemporaryDirectory() as directory:
                vendor = Path(directory)
                package = vendor / "anthropic"
                package.mkdir()
                (package / "__init__.py").write_text(
                    "VALUES = {'alpha', 'beta', 'gamma', 'delta'}\n"
                )
                results.append(
                    subprocess.check_output(
                        [sys.executable, "-c", script, str(compiler), str(vendor)],
                        env={**os.environ, "PYTHONHASHSEED": seed},
                    ).strip()
                )
        self.assertEqual(*results)


if __name__ == "__main__":
    unittest.main()
