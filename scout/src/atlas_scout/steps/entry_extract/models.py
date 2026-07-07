"""Structured output models for entry extraction."""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, BeforeValidator, Field

__all__ = [
    "ExtractionFailedError",
    "_StructuredExtractionItem",
    "_StructuredExtractionResponse",
    "_coerce_dict",
    "_coerce_mention_list",
    "_coerce_str_list",
]


class ExtractionFailedError(RuntimeError):
    """Raised when extraction fails due to provider or output issues."""


def _coerce_dict(v: dict[str, str] | None) -> dict[str, str]:
    return v if v is not None else {}


def _coerce_str_list(v: list[str] | None) -> list[str]:
    return v if v is not None else []


def _coerce_mention_list(v: list[dict[str, str]] | None) -> list[dict[str, str]]:
    return v if v is not None else []


class _StructuredExtractionItem(BaseModel):
    """Schema for one extracted Atlas entry."""

    name: str
    type: str
    description: str = ""
    city: str | None = None
    state: str | None = None
    geo_specificity: str = "local"
    issue_areas: Annotated[list[str], BeforeValidator(_coerce_str_list)] = Field(
        default_factory=list
    )
    region: str | None = None
    website: str | None = None
    email: str | None = None
    social_media: Annotated[dict[str, str], BeforeValidator(_coerce_dict)] = Field(
        default_factory=dict
    )
    affiliated_org: str | None = None
    extraction_context: str = ""
    mentioned_entities: Annotated[list[dict[str, str]], BeforeValidator(_coerce_mention_list)] = (
        Field(default_factory=list)
    )


class _StructuredExtractionResponse(BaseModel):
    """Strict structured-output envelope for extraction responses."""

    entries: list[_StructuredExtractionItem] = Field(default_factory=list)
    discovery_leads: list[str] = Field(default_factory=list)
