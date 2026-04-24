"""Shared enumeration types for the Atlas ecosystem."""

from enum import StrEnum

__all__ = [
    "DiscoveryRunStatus",
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


class DiscoveryRunStatus(StrEnum):
    """Lifecycle status for a discovery run tracked by Atlas."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class SourceType(StrEnum):
    """Type of source from which content was retrieved."""

    NEWS_ARTICLE = "news_article"
    OP_ED = "op_ed"
    ACADEMIC_PAPER = "academic_paper"
    REPORT = "report"
    GOVERNMENT_RECORD = "government_record"
    CONFERENCE = "conference"
    PODCAST = "podcast"
    VIDEO = "video"
    SOCIAL_MEDIA = "social_media"
    ORG_WEBSITE = "org_website"
    WEBSITE = "org_website"
    OTHER = "other"
