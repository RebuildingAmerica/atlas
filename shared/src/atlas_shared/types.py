"""Shared enumeration types for the Atlas ecosystem."""

from enum import StrEnum

__all__ = [
    "EntityType",
    "GeoSpecificity",
    "SourceType",
]


class EntityType(StrEnum):
    """Type of entity being catalogued."""

    PERSON = "person"
    ORGANIZATION = "organization"
    INITIATIVE = "initiative"
    CAMPAIGN = "campaign"
    EVENT = "event"


class GeoSpecificity(StrEnum):
    """Geographic scope of an entity or entry."""

    LOCAL = "local"
    REGIONAL = "regional"
    STATEWIDE = "statewide"
    NATIONAL = "national"


class SourceType(StrEnum):
    """Type of source from which content was retrieved."""

    NEWS_ARTICLE = "news_article"
    OP_ED = "op_ed"
    REPORT = "report"
    GOVERNMENT_RECORD = "government_record"
    PODCAST = "podcast"
    VIDEO = "video"
    SOCIAL_MEDIA = "social_media"
    WEBSITE = "website"
