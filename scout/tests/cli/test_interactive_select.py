"""Arrow-key selection helpers for Scout CLI prompts."""

from __future__ import annotations

import pytest

import atlas_scout.cli_select as select_module
from atlas_scout.cli_select import InteractiveChoice, SelectionCancelledError, select_with_arrows


def test_select_with_arrows_uses_prompt_toolkit_for_tty() -> None:
    captured: dict[str, object] = {}
    choices = (
        InteractiveChoice(value="lmstudio", label="LM Studio", detail="installed"),
        InteractiveChoice(value="ollama", label="Ollama", detail="installed"),
    )

    def run_dialog(
        title: str,
        text: str,
        values: tuple[tuple[int, str], ...],
    ) -> int | None:
        captured["title"] = title
        captured["text"] = text
        captured["values"] = values
        return 0

    selected = select_with_arrows(
        title="Local model provider",
        text="Choose the provider Scout should set up.",
        choices=choices,
        input_is_tty=lambda: True,
        output_is_tty=lambda: True,
        run_dialog=run_dialog,
    )

    assert selected == "lmstudio"
    assert captured == {
        "title": "Local model provider",
        "text": "Choose the provider Scout should set up.",
        "values": (
            (0, "LM Studio - installed"),
            (1, "Ollama - installed"),
        ),
    }


def test_select_with_arrows_returns_none_for_non_tty() -> None:
    choices = (InteractiveChoice(value="lmstudio", label="LM Studio", detail="installed"),)

    selected = select_with_arrows(
        title="Local model provider",
        text="Choose the provider Scout should set up.",
        choices=choices,
        input_is_tty=lambda: False,
        output_is_tty=lambda: True,
        run_dialog=lambda *_args: 0,
    )

    assert selected is None


def test_select_with_arrows_raises_when_user_cancels() -> None:
    choices = (InteractiveChoice(value="lmstudio", label="LM Studio", detail="installed"),)

    with pytest.raises(SelectionCancelledError):
        select_with_arrows(
            title="Local model provider",
            text="Choose the provider Scout should set up.",
            choices=choices,
            input_is_tty=lambda: True,
            output_is_tty=lambda: True,
            run_dialog=lambda *_args: None,
        )


def test_prompt_toolkit_selector_runs_in_thread(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def run(_application: object, *, in_thread: bool = False) -> int:
        captured["in_thread"] = in_thread
        return 0

    monkeypatch.setattr("prompt_toolkit.application.Application.run", run)

    selected = select_module._run_arrow_selector(
        "Local model provider",
        "Choose the provider Scout should set up.",
        ((0, "LM Studio - installed"),),
    )

    assert selected == 0
    assert captured == {"in_thread": True}
