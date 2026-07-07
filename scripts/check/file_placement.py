#!/usr/bin/env python3
"""Enforce Atlas file placement rules."""

from __future__ import annotations

import argparse
import dataclasses
import functools
import subprocess
import sys
import tomllib
from pathlib import Path

ALLOWED_ROOT_FILES = {"__init__.py", "conftest.py", "README.md", ".gitkeep"}
IGNORED_PATH_PARTS = {
    ".git",
    ".hypothesis",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".turbo",
    ".venv",
    "__pycache__",
    "coverage",
    "htmlcov",
    "node_modules",
    "playwright-report",
    "test-results",
}


@dataclasses.dataclass(frozen=True)
class Violation:
    """A file placement violation.

    Parameters
    ----------
    path
        Repository-relative path.
    reason
        Explanation for the policy violation.
    """

    path: str
    reason: str


def repo_root() -> Path:
    """Return the Atlas repository root.

    Returns
    -------
    Path
        Repository root.
    """

    return Path(__file__).resolve().parents[2]


def _git_paths(args: list[str], *, root: Path) -> list[str]:
    completed = subprocess.run(
        ["git", *args],
        cwd=root,
        check=True,
        capture_output=True,
    )
    return [item for item in completed.stdout.decode("utf-8").split("\0") if item]


def _normalise_path(raw_path: str, root: Path) -> Path | None:
    if not raw_path.strip():
        return None
    path = Path(raw_path)
    if not path.is_absolute():
        path = root / path
    try:
        return path.resolve().relative_to(root.resolve())
    except ValueError:
        return None


def _is_ignored(relative_path: Path) -> bool:
    return any(part in IGNORED_PATH_PARTS for part in relative_path.parts)


def _normalise_testpaths(raw_testpaths: object) -> list[Path]:
    if isinstance(raw_testpaths, str):
        return [Path(raw_testpaths)]
    if isinstance(raw_testpaths, list):
        return [Path(item) for item in raw_testpaths if isinstance(item, str)]
    return []


def _pyproject_paths(root: Path) -> list[Path]:
    try:
        paths = _git_paths(["ls-files", "-z", "**/pyproject.toml", "pyproject.toml"], root=root)
    except subprocess.CalledProcessError:
        paths = []
    if paths:
        return [root / path for path in paths]
    return [
        path for path in root.rglob("pyproject.toml") if not _is_ignored(path.relative_to(root))
    ]


@functools.cache
def discover_python_test_roots(root: Path) -> tuple[Path, ...]:
    """Discover Python test roots from package pytest configuration.

    Parameters
    ----------
    root
        Repository root.

    Returns
    -------
    tuple[Path, ...]
        Repository-relative test root paths.
    """

    test_roots: set[Path] = set()
    root = root.resolve()
    for pyproject_path in _pyproject_paths(root):
        relative_pyproject = pyproject_path.relative_to(root)
        with pyproject_path.open("rb") as file:
            pyproject = tomllib.load(file)
        pytest_options = pyproject.get("tool", {}).get("pytest", {}).get("ini_options", {})
        for testpath in _normalise_testpaths(pytest_options.get("testpaths")):
            absolute_test_root = (root / relative_pyproject.parent / testpath).resolve()
            test_roots.add(absolute_test_root.relative_to(root.resolve()))
    return tuple(sorted(test_roots))


def _is_root_python_test_module(relative_path: Path, test_root: Path) -> bool:
    if relative_path.parent != test_root:
        return False
    if relative_path.suffix != ".py":
        return False
    return relative_path.name.startswith("test_") or relative_path.name.endswith("_test.py")


def _is_unexpected_root_python_file(relative_path: Path, test_root: Path) -> bool:
    if relative_path.parent != test_root:
        return False
    if relative_path.suffix != ".py":
        return False
    return relative_path.name not in ALLOWED_ROOT_FILES


def classify_path(
    raw_path: str,
    repo_root: Path | None = None,
    *,
    require_exists: bool = False,
) -> list[Violation]:
    """Classify a path against Atlas file placement rules.

    Parameters
    ----------
    raw_path
        Absolute or repository-relative path to validate.
    repo_root
        Repository root. Defaults to this checkout.
    require_exists
        Skip paths that do not exist on disk.

    Returns
    -------
    list[Violation]
        Violations found for the path.
    """

    root = repo_root or globals()["repo_root"]()
    relative_path = _normalise_path(raw_path, root)
    if relative_path is None or _is_ignored(relative_path):
        return []
    if require_exists and not (root / relative_path).exists():
        return []

    for test_root in discover_python_test_roots(root):
        if _is_root_python_test_module(relative_path, test_root):
            return [
                Violation(
                    path=relative_path.as_posix(),
                    reason=(
                        "Python test modules must live under unit/, integration/, "
                        "e2e/, or another package-local test subdirectory, not "
                        f"directly in {test_root.as_posix()}"
                    ),
                )
            ]
        if _is_unexpected_root_python_file(relative_path, test_root):
            return [
                Violation(
                    path=relative_path.as_posix(),
                    reason=(
                        "Python files at a package test root must be conftest.py, "
                        "__init__.py, README.md, or .gitkeep"
                    ),
                )
            ]
    return []


def evaluate_paths(
    paths: list[str],
    repo_root: Path | None = None,
    *,
    require_exists: bool = False,
) -> list[Violation]:
    """Evaluate paths against Atlas file placement rules.

    Parameters
    ----------
    paths
        Paths to validate.
    repo_root
        Repository root. Defaults to this checkout.
    require_exists
        Skip paths that do not exist on disk.

    Returns
    -------
    list[Violation]
        Placement violations.
    """

    root = repo_root or globals()["repo_root"]()
    violations: list[Violation] = []
    for path in paths:
        violations.extend(classify_path(path, root, require_exists=require_exists))
    return violations


def collect_paths(args: argparse.Namespace, *, root: Path) -> list[str]:
    """Collect paths requested by command-line options.

    Parameters
    ----------
    args
        Parsed command-line arguments.
    root
        Repository root.

    Returns
    -------
    list[str]
        Paths to evaluate.
    """

    if args.paths:
        return args.paths
    if args.staged:
        return _git_paths(
            ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMRT"], root=root
        )
    if args.changed:
        paths = set(_git_paths(["diff", "--name-only", "-z", "--diff-filter=ACMRT"], root=root))
        paths.update(
            _git_paths(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMRT"], root=root)
        )
        paths.update(_git_paths(["ls-files", "--others", "--exclude-standard", "-z"], root=root))
        return sorted(paths)
    if args.tracked:
        return _git_paths(["ls-files", "-z"], root=root)
    return collect_paths(
        argparse.Namespace(paths=[], staged=False, changed=True, tracked=False), root=root
    )


def _print_violations(violations: list[Violation]) -> None:
    print("File placement check failed.")
    print("Keep Python tests out of package test roots; place them in a focused subdirectory.")
    print("")
    for violation in violations:
        print(f"- {violation.path}: {violation.reason}")


def build_parser() -> argparse.ArgumentParser:
    """Build the command-line parser.

    Returns
    -------
    argparse.ArgumentParser
        Parser for this command.
    """

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--paths", nargs="*", default=[], help="Explicit paths to validate.")
    parser.add_argument("--staged", action="store_true", help="Validate staged paths only.")
    parser.add_argument(
        "--changed", action="store_true", help="Validate changed and untracked paths."
    )
    parser.add_argument("--tracked", action="store_true", help="Validate all tracked paths.")
    return parser


def main(argv: list[str] | None = None) -> int:
    """Run the file placement check.

    Parameters
    ----------
    argv
        Command-line arguments.

    Returns
    -------
    int
        Process exit code.
    """

    parser = build_parser()
    args = parser.parse_args(argv)
    root = repo_root()
    try:
        paths = collect_paths(args, root=root)
    except subprocess.CalledProcessError as error:
        print(f"File placement check could not read git paths: {error}", file=sys.stderr)
        return 1

    violations = evaluate_paths(paths, root, require_exists=not bool(args.paths))
    if violations:
        _print_violations(violations)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
