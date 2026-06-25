"""Cheapest-first geocoding for catalog entries.

:func:`geocode_entry` is the single seam both the discovery pipeline and the
backfill script use to place an actor on the map. It resolves coordinates in
precision order, stopping at the first hit:

1. **Census rooftop** — a precise street-level point, but only when
   ``allow_remote`` is set (it costs a network round-trip), and only when a
   ``full_address`` is available to geocode.
2. **Gazetteer city** — an offline city centroid: instant, free, good enough to
   cluster an actor into the right town.
3. **State centroid** — a coarse but honest fallback so a state-only actor still
   appears somewhere sensible.
4. **None** — when we genuinely don't know, we say so; the actor is excluded
   from the map rather than dropped onto a guessed point.

Every result carries an explicit ``precision`` and ``source`` so the experience
can be honest about how confidently each dot is placed.
"""

from __future__ import annotations

import logging
from typing import NamedTuple

import httpx

from atlas.domains.catalog.geo.gazetteer import lookup_centroid, lookup_state_centroid

logger = logging.getLogger(__name__)

__all__ = ["GeocodeResult", "geocode_entry"]

_CENSUS_ONELINE_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
_CENSUS_BENCHMARK = "Public_AR_Current"
_CENSUS_TIMEOUT_SECONDS = 8.0


class GeocodeResult(NamedTuple):
    """A resolved location with explicit provenance.

    Attributes
    ----------
    latitude : float
        Resolved latitude.
    longitude : float
        Resolved longitude.
    precision : str
        How confidently the point is known: ``"rooftop"``, ``"city"``, or
        ``"state"``.
    source : str
        Who resolved it: ``"census"`` or ``"gazetteer"``.
    """

    latitude: float
    longitude: float
    precision: str
    source: str


async def _census_rooftop(full_address: str) -> GeocodeResult | None:
    """Resolve a street address to a rooftop point via the Census geocoder.

    Network failures and unparseable responses resolve to ``None`` so the caller
    falls through to the offline gazetteer — the cascade is the contract, not a
    silent default.

    Parameters
    ----------
    full_address : str
        A one-line street address (e.g. ``"123 Main St, Austin, TX"``).

    Returns
    -------
    GeocodeResult | None
        A rooftop result, or ``None`` when the address could not be matched.
    """
    params = {
        "address": full_address,
        "benchmark": _CENSUS_BENCHMARK,
        "format": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=_CENSUS_TIMEOUT_SECONDS) as client:
            response = await client.get(_CENSUS_ONELINE_URL, params=params)
    except httpx.HTTPError:
        logger.warning("Census geocoder request failed; falling back to gazetteer")
        return None

    if response.status_code != httpx.codes.OK:
        logger.warning(
            "Census geocoder returned unexpected status %s; falling back to gazetteer",
            response.status_code,
        )
        return None

    try:
        payload = response.json()
        matches = payload["result"]["addressMatches"]
    except (ValueError, KeyError, TypeError):
        logger.warning("Census geocoder response was unparseable; falling back to gazetteer")
        return None

    if not matches:
        return None

    coordinates = matches[0].get("coordinates")
    if not coordinates or "x" not in coordinates or "y" not in coordinates:
        return None

    return GeocodeResult(
        latitude=float(coordinates["y"]),
        longitude=float(coordinates["x"]),
        precision="rooftop",
        source="census",
    )


async def geocode_entry(
    city: str | None,
    state: str | None,
    full_address: str | None,
    *,
    allow_remote: bool = False,
) -> GeocodeResult | None:
    """Resolve an entry's location, cheapest-first, with explicit provenance.

    Parameters
    ----------
    city : str | None
        City name (used for the offline gazetteer-city lookup).
    state : str | None
        State code (used for both the city lookup and the state fallback).
    full_address : str | None
        One-line street address. Only consulted for a Census rooftop lookup,
        and only when ``allow_remote`` is set.
    allow_remote : bool, optional
        Whether a network round-trip to the Census geocoder is permitted.
        Defaults to ``False`` so the discovery pipeline stays fast and free.

    Returns
    -------
    GeocodeResult | None
        The most precise location we can resolve, or ``None`` when the place is
        genuinely unknown.
    """
    if allow_remote and full_address:
        rooftop = await _census_rooftop(full_address)
        if rooftop is not None:
            return rooftop

    city_centroid = lookup_centroid(city, state)
    if city_centroid is not None:
        return GeocodeResult(
            latitude=city_centroid.latitude,
            longitude=city_centroid.longitude,
            precision="city",
            source="gazetteer",
        )

    state_centroid = lookup_state_centroid(state)
    if state_centroid is not None:
        return GeocodeResult(
            latitude=state_centroid.latitude,
            longitude=state_centroid.longitude,
            precision="state",
            source="gazetteer",
        )

    return None
