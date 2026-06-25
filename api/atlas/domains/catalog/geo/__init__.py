"""Geographic placement for catalog entries.

This package turns an actor's ``city`` / ``state`` text into map coordinates so
the Atlas map can plot real people, organizations, and initiatives. Resolution
is cheapest-first and always honest about precision: a rooftop point beats a
city centroid beats a state centroid, and an unplaceable actor resolves to
``None`` rather than being guessed onto the map.
"""

from __future__ import annotations

from atlas.domains.catalog.geo.gazetteer import (
    Centroid,
    lookup_centroid,
    lookup_state_centroid,
)
from atlas.domains.catalog.geo.geocoder import GeocodeResult, geocode_entry

__all__ = [
    "Centroid",
    "GeocodeResult",
    "geocode_entry",
    "lookup_centroid",
    "lookup_state_centroid",
]
