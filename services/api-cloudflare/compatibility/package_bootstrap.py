"""Load a verified pure-package archive when evaluating the complete API bundle."""

import sys
from pathlib import Path


def install_package_archive():
    # The compatibility-only bundle remains usable without the full API archive.
    archive = Path(__file__).parent / "python_modules/packages.zip"
    if archive.is_file():
        sys.path.insert(0, str(archive))


install_package_archive()
