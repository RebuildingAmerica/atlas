"""Generate and install standard man pages for Scout commands."""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import click


@dataclass(frozen=True, slots=True)
class ManPage:
    """One generated man page."""

    filename: str
    content: str


@dataclass(frozen=True, slots=True)
class ManPageInstallResult:
    """Result of installing Scout man pages."""

    command_name: str
    man_dir: Path
    files: tuple[Path, ...]


def collect_man_pages(
    cli: click.Command,
    *,
    command_name: str,
    current_date: str | None = None,
) -> tuple[ManPage, ...]:
    """Return generated man pages for a Click command tree.

    Parameters
    ----------
    cli
        Root Click command.
    command_name
        Executable name to document, such as ``scout`` or ``scout-dev``.
    current_date
        Date for deterministic output. Defaults to today's UTC date.

    Returns
    -------
    tuple[ManPage, ...]
        Generated section 1 man pages.
    """
    man_date = current_date or datetime.now(UTC).date().isoformat()
    return tuple(
        _render_man_page(command, command_path=path, current_date=man_date)
        for path, command in _walk_public_commands(cli, (command_name,))
    )


def install_man_pages(
    cli: click.Command,
    *,
    command_name: str,
    man_dir: Path | str | None = None,
    current_date: str | None = None,
) -> ManPageInstallResult:
    """Generate and install Scout man pages.

    Parameters
    ----------
    cli
        Root Click command.
    command_name
        Executable name to document.
    man_dir
        Destination directory for section 1 man pages.
    current_date
        Date for deterministic output. Defaults to today's UTC date.

    Returns
    -------
    ManPageInstallResult
        Paths written by the install operation.
    """
    resolved_man_dir = Path(man_dir) if man_dir is not None else _default_man_dir()
    resolved_man_dir.mkdir(parents=True, exist_ok=True)
    written_files: list[Path] = []
    for page in collect_man_pages(cli, command_name=command_name, current_date=current_date):
        destination = resolved_man_dir / page.filename
        _atomic_write_text(destination, page.content)
        written_files.append(destination)
    return ManPageInstallResult(
        command_name=command_name,
        man_dir=resolved_man_dir,
        files=tuple(written_files),
    )


def _walk_public_commands(
    command: click.Command,
    command_path: tuple[str, ...],
) -> tuple[tuple[tuple[str, ...], click.Command], ...]:
    """Walk a Click tree in help order, skipping hidden commands."""
    entries: list[tuple[tuple[str, ...], click.Command]] = [(command_path, command)]
    if not isinstance(command, click.Group):
        return tuple(entries)

    for name, child in command.commands.items():
        if child.hidden:
            continue
        entries.extend(_walk_public_commands(child, (*command_path, name)))
    return tuple(entries)


def _render_man_page(
    command: click.Command,
    *,
    command_path: tuple[str, ...],
    current_date: str,
) -> ManPage:
    """Render one Click command as a section 1 man page."""
    man_name = "-".join(command_path)
    title = man_name.upper()
    synopsis = _synopsis(command, command_path)
    short_help = _short_help(command)
    sections = [
        f'.TH "{_escape_header(title)}" "1" "{_escape_header(current_date)}" '
        '"Atlas Scout" "Atlas Scout Manual"',
        ".SH NAME",
        f"{_escape_roff_text(man_name)} \\- {_escape_roff_text(short_help)}",
        ".SH SYNOPSIS",
        _escape_synopsis(synopsis, command_path=command_path),
    ]
    description = _description(command)
    if description:
        sections.extend([".SH DESCRIPTION", _escape_roff_text(description)])

    options = _option_lines(command)
    if options:
        sections.extend([".SH OPTIONS", *options])

    commands = _command_lines(command)
    if commands:
        sections.extend([".SH COMMANDS", *commands])

    return ManPage(filename=f"{man_name}.1", content="\n".join(sections) + "\n")


def _synopsis(command: click.Command, command_path: tuple[str, ...]) -> str:
    """Return a compact command synopsis."""
    ctx = click.Context(command, info_name=command_path[-1])
    usage_pieces = command.collect_usage_pieces(ctx)
    suffix = f" {' '.join(usage_pieces)}" if usage_pieces else ""
    return f"{' '.join(command_path)}{suffix}"


def _short_help(command: click.Command) -> str:
    """Return a stable one-line command summary."""
    return command.get_short_help_str(limit=500).rstrip(".") + "."


def _description(command: click.Command) -> str:
    """Return full command help without duplicating empty summaries."""
    help_text = (command.help or "").strip()
    return inspect.cleandoc(help_text) if help_text else ""


def _option_lines(command: click.Command) -> tuple[str, ...]:
    """Return roff option lines for a command."""
    lines: list[str] = []
    for param in command.params:
        if not isinstance(param, click.Option):
            continue
        opts = ", ".join((*param.opts, *param.secondary_opts))
        help_text = param.help or ""
        lines.extend(
            [
                ".TP",
                f"\\fB{_escape_roff_text(opts)}\\fR",
                _escape_roff_text(help_text) if help_text else "",
            ]
        )
    return tuple(lines)


def _command_lines(command: click.Command) -> tuple[str, ...]:
    """Return roff command lines for a Click group."""
    if not isinstance(command, click.Group):
        return ()

    lines: list[str] = []
    for name, child in command.commands.items():
        if child.hidden:
            continue
        lines.extend(
            [
                ".TP",
                f"\\fB{_escape_roff_text(name)}\\fR",
                _escape_roff_text(_short_help(child)),
            ]
        )
    return tuple(lines)


def _escape_synopsis(text: str, *, command_path: tuple[str, ...]) -> str:
    """Escape a synopsis while preserving bold executable text."""
    display_command = " ".join(command_path)
    rest = text.removeprefix(display_command).strip()
    escaped_command = _escape_roff_text(display_command)
    escaped_rest = _escape_roff_text(rest)
    return f"\\fB{escaped_command}\\fR {escaped_rest}".rstrip()


def _escape_header(text: str) -> str:
    """Escape text used inside roff header quotes."""
    return text.replace('"', '\\"')


def _escape_roff_text(text: str) -> str:
    """Escape user-facing text for roff output."""
    escaped_lines: list[str] = []
    for line in text.splitlines() or [""]:
        escaped = line.replace("\\", "\\\\").replace("-", "\\-")
        if escaped.startswith((".", "'")):
            escaped = f"\\&{escaped}"
        escaped_lines.append(escaped)
    return "\n".join(escaped_lines)


def _default_man_dir() -> Path:
    """Return the standard user-level man section 1 directory."""
    return Path.home() / ".local/share/man/man1"


def _atomic_write_text(path: Path, text: str) -> None:
    """Write text through a temporary file before replacing the destination."""
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)
