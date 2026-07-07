"""Atlas Scout CLI entrypoint."""

from __future__ import annotations

from atlas_scout.cli_app import main
from atlas_scout.cli_compat import install_legacy_cli_facade

__all__ = ("main", *install_legacy_cli_facade(__name__, globals()))


if __name__ == "__main__":
    main()
