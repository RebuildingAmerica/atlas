"""Shared page-content schema."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from atlas_shared.types import SourceType


class PageContent(BaseModel):
    """Extracted text content from a single web page."""

    url: str = Field(..., description="Source URL.")
    title: str = Field(default="", description="Page title.")
    text: str = Field(default="", description="Main extracted text content.")
    task_id: str | None = Field(None, description="Owning Scout page-task ID.")
    discovered_links: list[str] = Field(
        default_factory=list,
        description="Same-domain links discovered while fetching this page.",
    )
    publication: str | None = Field(None, description="Publication or site name.")
    published_date: datetime | None = Field(None, description="Article publication datetime.")
    source_type: SourceType = Field(
        default=SourceType.WEBSITE,
        description="Classified source type.",
    )
    structured_data: dict[str, Any] = Field(
        default_factory=dict,
        description="Structured data extracted from HTML (JSON-LD, OpenGraph, meta tags).",
    )
