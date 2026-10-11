"""Exercise every locale's data and representative public Babel formatting."""

import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "locales", Path(__file__).with_name("api-cloudflare-locales.py")
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class LocaleCompressionTests(unittest.TestCase):
    def test_all_locales_and_public_formatting_are_preserved(self):
        import babel

        with tempfile.TemporaryDirectory() as directory:
            vendor = Path(directory)
            shutil.copytree(Path(babel.__file__).parent, vendor / "babel")
            program = """
import hashlib,json,pickle
from datetime import date
from babel import Locale,localedata
from babel.dates import format_date
from babel.numbers import format_decimal
ids=sorted(localedata.locale_identifiers())
data={name:hashlib.sha256(pickle.dumps(localedata.load(name,merge_inherited=False))).hexdigest() for name in ["root",*ids]}
localedata._cache.clear()
formats={name:[format_date(date(2026,10,10),locale=name),format_decimal(12345.678,locale=name),Locale.parse(name).english_name] for name in ["en_US","es_MX","fr_FR","ar_EG","hi_IN","zh_Hans_CN","ja_JP","ru_RU"]}
print(json.dumps({"data":data,"formats":formats},sort_keys=True))
"""
            env = {**os.environ, "PYTHONPATH": str(vendor)}
            before = subprocess.check_output(
                ["python3", "-c", program], cwd=directory, env=env
            )
            provenance = MODULE.compress_locales(vendor)
            after = subprocess.check_output(
                ["python3", "-c", program], cwd=directory, env=env
            )
            self.assertEqual(json.loads(before), json.loads(after))
            archive = vendor / "packages.zip"
            with zipfile.ZipFile(
                archive, "w", compression=zipfile.ZIP_DEFLATED
            ) as output:
                for path in (vendor / "babel").rglob("*"):
                    if path.is_file() and "__pycache__" not in path.parts:
                        output.write(path, path.relative_to(vendor))
            (vendor / "babel").rename(vendor / "original-babel")
            zipped = subprocess.check_output(
                ["python3", "-c", program],
                cwd=directory,
                env={**os.environ, "PYTHONPATH": str(archive)},
            )
            self.assertEqual(json.loads(before), json.loads(zipped))
            (vendor / "original-babel").rename(vendor / "babel")
            self.assertGreater(len(provenance["locales"]), 1000)
            self.assertLess(
                sum(x["compressedBytes"] for x in provenance["locales"]),
                sum(x["bytes"] for x in provenance["locales"]),
            )
            with self.assertRaisesRegex(ValueError, "loader changed"):
                MODULE.compress_locales(vendor)


if __name__ == "__main__":
    unittest.main()
