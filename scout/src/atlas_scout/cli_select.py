"""Interactive selection helpers for Scout CLI prompts."""

from __future__ import annotations

import sys
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from prompt_toolkit.key_binding.key_processor import KeyPressEvent

DialogValue = tuple[int, str]
DialogRunner = Callable[[str, str, tuple[DialogValue, ...]], int | None]
TtyCheck = Callable[[], bool]


class SelectionCancelledError(Exception):
    """Raised when a user cancels an interactive selection."""


@dataclass(frozen=True, slots=True)
class InteractiveChoice[ChoiceValue]:
    """One selectable item in an arrow-key prompt."""

    value: ChoiceValue
    label: str
    detail: str | None = None


def select_with_arrows[ChoiceValue](
    *,
    title: str,
    text: str,
    choices: tuple[InteractiveChoice[ChoiceValue], ...],
    input_is_tty: TtyCheck = sys.stdin.isatty,
    output_is_tty: TtyCheck = sys.stdout.isatty,
    run_dialog: DialogRunner | None = None,
) -> ChoiceValue | None:
    """Return an arrow-key selection, or ``None`` when no TTY is available."""
    if not input_is_tty() or not output_is_tty():
        return None

    values = tuple((index, _choice_display(choice)) for index, choice in enumerate(choices))
    dialog_runner = run_dialog or _run_arrow_selector
    selected_index = dialog_runner(title, text, values)
    if selected_index is None:
        raise SelectionCancelledError
    return choices[selected_index].value


def _choice_display[ChoiceValue](choice: InteractiveChoice[ChoiceValue]) -> str:
    if choice.detail is None:
        return choice.label
    return f"{choice.label} - {choice.detail}"


def _run_arrow_selector(
    title: str,
    text: str,
    values: tuple[DialogValue, ...],
) -> int | None:
    from prompt_toolkit.application import Application
    from prompt_toolkit.key_binding import KeyBindings
    from prompt_toolkit.layout import Layout
    from prompt_toolkit.layout.containers import HSplit, Window
    from prompt_toolkit.layout.controls import FormattedTextControl
    from prompt_toolkit.styles import Style

    if not values:
        return None

    selected_index = 0

    def formatted_choices() -> list[tuple[str, str]]:
        fragments: list[tuple[str, str]] = [
            ("class:title", f"{title}\n"),
            ("", f"{text}\n\n"),
        ]
        for index, (_value, label) in enumerate(values):
            if index == selected_index:
                fragments.append(("class:selected", f"> {label}\n"))
            else:
                fragments.append(("", f"  {label}\n"))
        fragments.append(("", "\n"))
        fragments.append(("class:hint", "Use up/down, Enter to choose, Esc to cancel."))
        return fragments

    bindings = KeyBindings()

    @bindings.add("down")
    def _select_next(event: KeyPressEvent) -> None:
        nonlocal selected_index
        selected_index = (selected_index + 1) % len(values)
        event.app.invalidate()

    @bindings.add("up")
    def _select_previous(event: KeyPressEvent) -> None:
        nonlocal selected_index
        selected_index = (selected_index - 1) % len(values)
        event.app.invalidate()

    @bindings.add("enter")
    def _accept(event: KeyPressEvent) -> None:
        event.app.exit(result=values[selected_index][0])

    @bindings.add("escape")
    def _cancel(event: KeyPressEvent) -> None:
        event.app.exit(result=None)

    @bindings.add("c-c")
    def _interrupt(event: KeyPressEvent) -> None:
        event.app.exit(result=None)

    class ScoutSelectionApplication(Application[int | None]):
        def cpr_not_supported_callback(self) -> None:
            return

    control = FormattedTextControl(formatted_choices)
    application: Application[int | None] = ScoutSelectionApplication(
        layout=Layout(HSplit([Window(content=control, dont_extend_height=True)])),
        key_bindings=bindings,
        style=Style.from_dict(
            {
                "title": "bold",
                "selected": "reverse",
                "hint": "ansigray",
            }
        ),
        full_screen=False,
        erase_when_done=True,
    )
    return application.run(in_thread=True)
