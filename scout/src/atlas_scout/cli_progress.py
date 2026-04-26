"""User-facing and verbose progress rendering for the Scout CLI."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from rich.console import Console

_STATUS_QUIET_SECONDS = 5.0

_USER_EVENT_LABELS = {
    "page_found": "PAGE_FOUND",
    "page_fetched": "PAGE_FETCHED",
    "page_skipped": "PAGE_SKIPPED",
    "page_failed": "PAGE_FAILED",
    "entity_found": "ENTITY_FOUND",
}

_VERBOSE_EVENT_LABELS = {
    "frontier_queued": "FRONTIER_QUEUED",
    "fetch_started": "FETCH_STARTED",
    "fetch_completed": "FETCH_COMPLETED",
    "fetch_skipped": "FETCH_SKIPPED",
    "fetch_failed": "FETCH_FAILED",
    "extract_started": "EXTRACT_STARTED",
    "extract_retry": "EXTRACT_RETRIED",
    "extract_completed": "EXTRACT_COMPLETED",
    "extract_empty": "EXTRACT_RETURNED_EMPTY",
    "extract_failed": "EXTRACT_FAILED",
    "entry_found": "ENTITY_FOUND",
    "entity_found": "ENTITY_FOUND",
    "page_found": "PAGE_FOUND",
    "page_fetched": "PAGE_FETCHED",
    "page_skipped": "PAGE_SKIPPED",
    "page_failed": "PAGE_FAILED",
    "status": "WORK_RECORDED",
}


@dataclass(slots=True)
class ProgressRenderer:
    """Render Scout pipeline events for either end users or verbose debugging."""

    console: Console
    quiet: bool = False
    verbose: bool = False
    started_at: float = field(default_factory=time.perf_counter)
    last_status_print_at: float = field(init=False)
    active_fetches: dict[str, tuple[float, str]] = field(default_factory=dict)
    active_extracts: dict[str, tuple[float, str]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.last_status_print_at = self.started_at

    def emit(self, event: str, payload: dict[str, object]) -> None:
        """Render one progress event."""
        if self.quiet:
            return
        elapsed = f"{time.perf_counter() - self.started_at:7.2f}s"
        if self.verbose:
            self._render_verbose_event(event, payload, elapsed=elapsed)
            return
        self._render_user_event(event, payload, elapsed=elapsed)

    def _render_user_event(
        self,
        event: str,
        payload: dict[str, object],
        *,
        elapsed: str,
    ) -> None:
        label = _USER_EVENT_LABELS.get(event)
        if label is None:
            return
        fields = _user_event_fields(payload)
        self._print_line(label, fields, elapsed=elapsed)

    def _render_verbose_event(
        self,
        event: str,
        payload: dict[str, object],
        *,
        elapsed: str,
    ) -> None:
        label = _VERBOSE_EVENT_LABELS.get(event, event.upper())
        event_key = _event_key(payload)
        now = time.perf_counter()

        if event == "fetch_started" and event_key is not None:
            self.active_fetches[event_key] = (now, str(payload.get("url") or ""))
        elif event == "extract_started" and event_key is not None:
            self.active_extracts[event_key] = (now, str(payload.get("url") or ""))
        elif event in {"fetch_completed", "fetch_skipped", "fetch_failed"} and event_key is not None:
            self.active_fetches.pop(event_key, None)
        elif event in {"extract_completed", "extract_empty", "extract_failed"} and event_key is not None:
            self.active_extracts.pop(event_key, None)

        if event == "status":
            fields = self._status_fields(payload, now=now)
            if fields is None:
                return
            self._print_line(label, fields, elapsed=elapsed)
            return

        fields = _verbose_event_fields(payload)
        self._print_line(label, fields, elapsed=elapsed)

    def _status_fields(
        self,
        payload: dict[str, object],
        *,
        now: float,
    ) -> list[str] | None:
        if now - self.last_status_print_at < _STATUS_QUIET_SECONDS:
            return None

        fetch_active = int(payload.get("fetch_active") or 0)
        extract_active = int(payload.get("extract_active") or 0)
        if fetch_active <= 0 and extract_active <= 0:
            return None

        fields = [
            f"frontier_q={payload.get('frontier_queued')}",
            f"extract_q={payload.get('extract_queued')}",
            f"fetch_active={fetch_active}",
            f"extract_active={extract_active}",
            f"entries_found={payload.get('entries_found')}",
        ]
        oldest_fetch = _oldest_work_item(self.active_fetches, now)
        if oldest_fetch is not None:
            fields.append(f"oldest_fetch_age={oldest_fetch[0]:.1f}s")
            if oldest_fetch[1]:
                fields.append(f"oldest_fetch_url={oldest_fetch[1]}")
        oldest_extract = _oldest_work_item(self.active_extracts, now)
        if oldest_extract is not None:
            fields.append(f"oldest_extract_age={oldest_extract[0]:.1f}s")
            if oldest_extract[1]:
                fields.append(f"oldest_extract_url={oldest_extract[1]}")

        self.last_status_print_at = now
        return fields

    def _print_line(self, label: str, fields: list[str], *, elapsed: str) -> None:
        suffix = f" {' '.join(fields)}" if fields else ""
        self.console.print(f"{elapsed} [bold]{label:<13}[/]{suffix}")


def filter_visible_page_outcomes(page_outcomes: list[dict[str, object]]) -> list[dict[str, object]]:
    """Keep only user-visible page outcomes when visibility is tracked."""
    visible = [outcome for outcome in page_outcomes if outcome.get("user_visible") is True]
    if visible:
        return visible
    if any("user_visible" in outcome for outcome in page_outcomes):
        return []
    return page_outcomes


def _user_event_fields(payload: dict[str, object]) -> list[str]:
    fields: list[str] = []
    _append_if_present(fields, "depth", payload.get("depth"))
    _append_if_present(fields, "reason", payload.get("reason"))
    _append_if_present(fields, "name", payload.get("name"))
    if payload.get("entry_type"):
        fields.append(f"type={payload['entry_type']}")
    _append_if_present(fields, "links_found", payload.get("links_found"))
    _append_if_present(fields, "links_queued", payload.get("links_queued"))
    _append_if_present(fields, "url", payload.get("url"))
    return fields


def _verbose_event_fields(payload: dict[str, object]) -> list[str]:
    fields: list[str] = []
    _append_if_present(fields, "depth", payload.get("depth"))
    _append_if_present(fields, "attempt", payload.get("attempt"))
    _append_if_present(fields, "reason", payload.get("reason"))
    if payload.get("entries") not in (None, 0):
        fields.append(f"entries={payload['entries']}")
    if payload.get("discovered_links") not in (None, 0):
        fields.append(f"links_found={payload['discovered_links']}")
    if payload.get("queued_links") not in (None, 0):
        fields.append(f"links_queued={payload['queued_links']}")
    _append_if_present(fields, "name", payload.get("name"))
    _append_if_present(fields, "url", payload.get("url"))
    return fields


def _append_if_present(fields: list[str], name: str, value: object) -> None:
    if value in (None, ""):
        return
    fields.append(f"{name}={value}")


def _event_key(payload: dict[str, object]) -> str | None:
    task_id = payload.get("task_id")
    if isinstance(task_id, str) and task_id:
        return task_id
    url = payload.get("url")
    if isinstance(url, str) and url:
        return url
    return None


def _oldest_work_item(
    items: dict[str, tuple[float, str]],
    now: float,
) -> tuple[float, str] | None:
    if not items:
        return None
    started_at, url = min(items.values(), key=lambda item: item[0])
    return now - started_at, url
