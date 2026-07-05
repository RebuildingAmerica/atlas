"""Man page install tests for Scout."""

from __future__ import annotations

import click

from atlas_scout.manpages import install_man_pages


def test_install_man_pages_writes_standard_man1_files(tmp_path) -> None:
    """Setup installs generated man pages as ordinary man section 1 files."""

    @click.command(help="Run Scout.")
    def cli() -> None:
        pass

    result = install_man_pages(
        cli,
        command_name="scout",
        man_dir=tmp_path / "man1",
        current_date="2026-07-05",
    )

    assert result.man_dir == tmp_path / "man1"
    assert result.files == (tmp_path / "man1" / "scout.1",)
    assert result.files[0].read_text(encoding="utf-8").startswith(
        '.TH "SCOUT" "1" "2026-07-05"'
    )
