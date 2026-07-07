"""Firehose observation bus message helpers."""

from __future__ import annotations

import base64
import binascii
import json
from dataclasses import dataclass
from typing import Any, NoReturn

INVALID_OBSERVATION_DELIVERY_MESSAGE = "Invalid Firehose observation delivery."


@dataclass(slots=True)
class FirehoseObservationDelivery:
    """Decoded delivery for one persisted Firehose observation."""

    observation_id: str


def _invalid_delivery() -> NoReturn:
    raise ValueError(INVALID_OBSERVATION_DELIVERY_MESSAGE)


def parse_observation_delivery(payload: dict[str, Any]) -> FirehoseObservationDelivery:
    """Decode a Pub/Sub push envelope into a Firehose observation delivery."""
    try:
        message = payload["message"]
        if not isinstance(message, dict):
            _invalid_delivery()
        encoded = message["data"]
        if not isinstance(encoded, str):
            _invalid_delivery()
        decoded = base64.b64decode(encoded, validate=True).decode()
        data = json.loads(decoded)
        observation_id = data["observation_id"]
    except (KeyError, ValueError, UnicodeDecodeError, binascii.Error, json.JSONDecodeError) as exc:
        raise ValueError(INVALID_OBSERVATION_DELIVERY_MESSAGE) from exc

    if not isinstance(observation_id, str) or not observation_id:
        _invalid_delivery()

    return FirehoseObservationDelivery(observation_id=observation_id)
