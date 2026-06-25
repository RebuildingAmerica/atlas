"""Offline city / state centroid lookups.

The gazetteer answers "roughly where is this place?" without any network call.
It loads a curated, public-domain table of US city centroids bundled with the
package, plus a 50-state centroid fallback, so the map can place an actor the
moment they are discovered — free, instant, and offline.

City names are normalized before lookup so common spelling variants resolve to
the same row: ``"St. Louis"`` and ``"Saint Louis"`` both hit, as do casing and
extra-whitespace differences. This is a foundation, not a ceiling — the CSV is
expandable, and a remote rooftop geocoder (see :mod:`.geocoder`) layers on top
when a more precise point is worth the call.
"""

from __future__ import annotations

import csv
import functools
import importlib.resources
from typing import NamedTuple

__all__ = [
    "Centroid",
    "lookup_centroid",
    "lookup_state_centroid",
    "normalize_city",
    "normalize_state",
]

_CSV_PACKAGE = "atlas.domains.catalog.geo.data"
_CSV_RESOURCE = "us_city_centroids.csv"


class Centroid(NamedTuple):
    """A latitude / longitude pair for a place."""

    latitude: float
    longitude: float


def normalize_state(state: str) -> str:
    """Normalize a state code for keying.

    Parameters
    ----------
    state : str
        Raw state value (e.g. ``"mo"``, ``" MO "``).

    Returns
    -------
    str
        Upper-cased, whitespace-stripped state code.
    """
    return state.strip().upper()


def normalize_city(city: str) -> str:
    """Normalize a city name so spelling variants collide on one key.

    Lower-cases, collapses internal whitespace, drops periods, and canonicalizes
    the ``Saint`` / ``St`` prefix so ``"St. Louis"`` and ``"Saint Louis"`` map to
    the same key.

    Parameters
    ----------
    city : str
        Raw city name.

    Returns
    -------
    str
        Normalized lookup key.
    """
    collapsed = " ".join(city.split())
    without_periods = collapsed.replace(".", "")
    lowered = without_periods.lower()
    tokens = lowered.split(" ")
    canonical = ["saint" if token == "st" else token for token in tokens]
    return " ".join(canonical)


def _centroid_key(city: str, state: str) -> tuple[str, str]:
    """Build the normalized ``(city, state)`` key used by the gazetteer index."""
    return (normalize_city(city), normalize_state(state))


@functools.lru_cache(maxsize=1)
def _load_city_index() -> dict[tuple[str, str], Centroid]:
    """Load and index the bundled city-centroid CSV.

    Returns
    -------
    dict[tuple[str, str], Centroid]
        Mapping of normalized ``(city, state)`` keys to centroids. Cached for
        the process lifetime since the table is read-only.
    """
    resource = importlib.resources.files(_CSV_PACKAGE) / _CSV_RESOURCE
    text = resource.read_text(encoding="utf-8")
    index: dict[tuple[str, str], Centroid] = {}
    reader = csv.DictReader(text.splitlines())
    for row in reader:
        key = _centroid_key(row["city"], row["state"])
        index[key] = Centroid(
            latitude=float(row["latitude"]),
            longitude=float(row["longitude"]),
        )
    return index


# Geographic state centroids (DC included). Used only when a specific city is
# unknown, so an actor in a known state still lands somewhere honest.
_STATE_CENTROIDS: dict[str, Centroid] = {
    "AL": Centroid(32.81, -86.79),
    "AK": Centroid(61.37, -152.40),
    "AZ": Centroid(33.73, -111.43),
    "AR": Centroid(34.97, -92.37),
    "CA": Centroid(36.78, -119.42),
    "CO": Centroid(39.06, -105.31),
    "CT": Centroid(41.60, -72.76),
    "DE": Centroid(39.32, -75.51),
    "DC": Centroid(38.91, -77.01),
    "FL": Centroid(27.77, -81.69),
    "GA": Centroid(33.04, -83.64),
    "HI": Centroid(21.09, -157.50),
    "ID": Centroid(44.24, -114.48),
    "IL": Centroid(40.35, -88.99),
    "IN": Centroid(39.85, -86.26),
    "IA": Centroid(42.01, -93.21),
    "KS": Centroid(38.53, -96.73),
    "KY": Centroid(37.67, -84.67),
    "LA": Centroid(31.17, -91.87),
    "ME": Centroid(44.69, -69.38),
    "MD": Centroid(39.06, -76.80),
    "MA": Centroid(42.23, -71.53),
    "MI": Centroid(43.33, -84.54),
    "MN": Centroid(45.69, -93.90),
    "MS": Centroid(32.74, -89.68),
    "MO": Centroid(38.46, -92.29),
    "MT": Centroid(46.92, -110.45),
    "NE": Centroid(41.13, -98.27),
    "NV": Centroid(38.31, -117.06),
    "NH": Centroid(43.45, -71.56),
    "NJ": Centroid(40.30, -74.52),
    "NM": Centroid(34.84, -106.25),
    "NY": Centroid(42.17, -74.95),
    "NC": Centroid(35.63, -79.81),
    "ND": Centroid(47.53, -99.78),
    "OH": Centroid(40.39, -82.76),
    "OK": Centroid(35.57, -96.93),
    "OR": Centroid(44.57, -122.07),
    "PA": Centroid(40.59, -77.21),
    "RI": Centroid(41.68, -71.51),
    "SC": Centroid(33.86, -80.95),
    "SD": Centroid(44.30, -99.44),
    "TN": Centroid(35.75, -86.69),
    "TX": Centroid(31.05, -97.56),
    "UT": Centroid(40.15, -111.86),
    "VT": Centroid(44.05, -72.71),
    "VA": Centroid(37.77, -78.17),
    "WA": Centroid(47.40, -121.49),
    "WV": Centroid(38.49, -80.95),
    "WI": Centroid(44.27, -89.62),
    "WY": Centroid(42.76, -107.30),
}


def lookup_state_centroid(state: str | None) -> Centroid | None:
    """Resolve a state code to its centroid.

    Parameters
    ----------
    state : str | None
        State code (case-insensitive). ``None`` resolves to ``None``.

    Returns
    -------
    Centroid | None
        The state centroid, or ``None`` when the code is unknown.
    """
    if not state:
        return None
    return _STATE_CENTROIDS.get(normalize_state(state))


def lookup_centroid(city: str | None, state: str | None) -> Centroid | None:
    """Resolve a ``city`` + ``state`` pair to a city centroid.

    Both fields are required to hit the city index; if either is missing the
    lookup returns ``None`` (the caller can then fall back to a state centroid).

    Parameters
    ----------
    city : str | None
        City name (spelling variants are normalized).
    state : str | None
        State code (case-insensitive).

    Returns
    -------
    Centroid | None
        The city centroid, or ``None`` when the place is not in the table.
    """
    if not city or not state:
        return None
    return _load_city_index().get(_centroid_key(city, state))
