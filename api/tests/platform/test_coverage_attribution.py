"""No test may rewrite a module's ``__file__``: coverage attributes its lines by it.

Coverage decides which file a frame belongs to from the frame's ``__file__``
global and remembers the answer per code file for the rest of the process. Under
a serial run that answer is settled when the module is imported, before any test
runs. A pytest-xdist worker starts measuring only after its conftest has already
imported the application, so the first traced frame from a module can fall inside
a test. If that test has pointed ``__file__`` at a temporary directory, coverage
files every line the module runs under the fake path and drops them from the
report. Whether it happens depends on which tests the worker ran earlier, so a
gap appears on one run and not the next, and ``-n auto`` disagrees with serial.

The fix belongs in the code under test: give it a module-level constant, such as
``atlas.platform.openapi.PROJECT_ROOT``, that a test can replace instead.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

TESTS_ROOT = Path(__file__).resolve().parents[1]

# The calls that set an attribute by name or by dotted path.
_SETTERS = {"setattr", "object", "patch"}


def _callee(node: ast.Call) -> str:
    """Return the final name a call goes through, e.g. ``object`` for ``patch.object``."""
    func = node.func
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return ""


def _is_file_attribute(node: ast.expr) -> bool:
    """Whether an argument names ``__file__``, bare or at the end of a dotted path."""
    return (
        isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and (node.value == "__file__" or node.value.endswith(".__file__"))
    )


def _rewrites_file(node: ast.Assign | ast.Call) -> bool:
    """Whether a statement or call assigns to, or sets by name, a ``__file__``."""
    if isinstance(node, ast.Assign):
        return any(
            isinstance(target, ast.Attribute) and target.attr == "__file__"
            for target in node.targets
        )
    return _callee(node) in _SETTERS and any(
        _is_file_attribute(argument) for argument in node.args[:2]
    )


def lines_rewriting_file(source: str) -> list[int]:
    """Return the line numbers where the source rewrites a ``__file__``.

    Parameters
    ----------
    source
        Python source text.

    Returns
    -------
    list[int]
        Line numbers of assignments to, and ``setattr``/``patch`` calls on, ``__file__``.
    """
    return sorted(
        node.lineno
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Assign | ast.Call) and _rewrites_file(node)
    )


@pytest.mark.parametrize(
    "source",
    [
        "monkeypatch.setattr(module, '__file__', path)",
        "patch.object(module, '__file__', path)",
        "setattr(module, '__file__', path)",
        "patch('atlas.platform.openapi.__file__', path)",
        "monkeypatch.setattr('atlas.platform.openapi.__file__', path)",
        "module.__file__ = path",
    ],
)
def test_scanner_flags_every_way_of_rewriting_a_module_file(source: str) -> None:
    """The scan must catch the spellings a test would use."""
    assert lines_rewriting_file(source) == [1]


@pytest.mark.parametrize(
    "source",
    [
        "root = Path(__file__).resolve().parents[2]",
        "monkeypatch.setattr(module, 'PROJECT_ROOT', path)",
        "name = module.__file__",
        "text.endswith('.__file__')",
    ],
)
def test_scanner_ignores_reading_a_module_file(source: str) -> None:
    """Reading ``__file__`` to locate fixtures is fine; only rewriting it is not."""
    assert lines_rewriting_file(source) == []


def test_no_test_rewrites_a_module_file() -> None:
    """Each offender is reported with its line so the fix is one hop away."""
    offenders = [
        f"{path.relative_to(TESTS_ROOT.parent)}:{line}"
        for path in sorted(TESTS_ROOT.rglob("*.py"))
        if path != Path(__file__).resolve()
        for line in lines_rewriting_file(path.read_text(encoding="utf-8"))
    ]

    assert not offenders, (
        "Rewriting __file__ makes coverage drop the module's lines under pytest-xdist. "
        "Point the code under test at a module-level constant and patch that instead: "
        + ", ".join(offenders)
    )
