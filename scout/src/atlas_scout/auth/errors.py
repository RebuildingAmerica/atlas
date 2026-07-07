"""Structured errors and payload parsing for Atlas device-auth responses."""

from __future__ import annotations


class DeviceAuthError(RuntimeError):
    """Raised when the Atlas device authorization flow returns an OAuth error."""

    def __init__(
        self,
        *,
        error: str,
        description: str,
        status_code: int | None = None,
        url: str | None = None,
        content_type: str | None = None,
    ) -> None:
        self.error = error
        self.description = description
        self.status_code = status_code
        self.url = url
        self.content_type = content_type
        message = f"{error}: {description}" if description else error
        super().__init__(message)


def payload_int(payload: dict[str, object], key: str) -> int:
    """Return an integer field from a JSON payload or raise a response error."""
    value = payload.get(key)
    if isinstance(value, bool):
        raise DeviceAuthError(
            error="invalid_response",
            description=f"Atlas returned an invalid {key} value.",
        )
    if isinstance(value, int | float | str):
        try:
            return int(value)
        except (TypeError, ValueError) as exc:
            raise DeviceAuthError(
                error="invalid_response",
                description=f"Atlas returned an invalid {key} value.",
            ) from exc
    raise DeviceAuthError(
        error="invalid_response",
        description=f"Atlas returned an invalid {key} value.",
    )


def payload_str(payload: dict[str, object], key: str) -> str:
    """Return a string field from a JSON payload or raise a response error."""
    value = payload.get(key)
    if isinstance(value, str):
        return value
    raise DeviceAuthError(
        error="invalid_response",
        description=f"Atlas returned an invalid {key} value.",
    )


def optional_payload_str(payload: dict[str, object], key: str, default: str = "") -> str:
    """Return an optional string field from a JSON payload."""
    value = payload.get(key, default)
    if isinstance(value, str):
        return value
    raise DeviceAuthError(
        error="invalid_response",
        description=f"Atlas returned an invalid {key} value.",
    )


def optional_payload_str_or_none(payload: dict[str, object], key: str) -> str | None:
    """Return an optional nullable string field from a JSON payload."""
    value = payload.get(key)
    if value is None:
        return None
    if isinstance(value, str):
        return value
    raise DeviceAuthError(
        error="invalid_response",
        description=f"Atlas returned an invalid {key} value.",
    )


def optional_payload_int(payload: dict[str, object], key: str, default: int) -> int:
    """Return an optional integer field from a JSON payload."""
    if key not in payload:
        return default
    return payload_int(payload, key)
