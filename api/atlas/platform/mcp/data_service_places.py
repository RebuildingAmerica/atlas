"""Place/profile helpers for `atlas.platform.mcp.data`."""

from __future__ import annotations

from .data_service_places_context import AtlasDataServicePlaceContextMixin
from .data_service_places_coverage import AtlasDataServicePlaceCoverageMixin


class AtlasDataServicePlaceMixin(
    AtlasDataServicePlaceContextMixin,
    AtlasDataServicePlaceCoverageMixin,
):
    pass
