"""Source schemas for API responses."""

from pydantic import BaseModel, Field

__all__ = ["SourceResponse"]


class SourceResponse(BaseModel):
    """Source response model."""

    id: str = Field(..., description="Source ID")
    url: str = Field(..., description="Source URL")
    title: str | None = Field(None, description="Page title")
    publication: str | None = Field(None, description="Publication name")
    published_date: str | None = Field(None, description="Publication date (ISO format)")
    type: str = Field(..., description="Source type")
    ingested_at: str = Field(..., description="Ingestion timestamp")
    extraction_method: str = Field(..., description="Extraction method")
    extraction_context: str | None = Field(None, description="Passage supporting extraction")
    created_at: str = Field(..., description="Creation timestamp")

    model_config = {
        "json_schema_extra": {
            "example": {
                "id": "550e8400-e29b-41d4-a716-446655440001",
                "url": "https://atlas.rebuildingus.org/article",
                "title": "Garden City cooperative offers new model",
                "publication": "Wichita Eagle",
                "published_date": "2026-01-15",
                "type": "news_article",
                "ingested_at": "2026-01-15T10:30:00+00:00",
                "extraction_method": "autodiscovery",
                "created_at": "2026-01-15T10:30:00+00:00",
            }
        }
    }
