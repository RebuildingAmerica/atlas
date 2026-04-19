"""
The Atlas API — a discovery platform for people, organizations, and initiatives
working on contemporary American issues.

This package provides:
- Autodiscovery pipeline: search → extract → deduplicate → rank
- Data models: entries, sources, issue areas
- API endpoints: entries, discovery runs, taxonomy
- SQLite storage with FTS5 full-text search
"""

__version__ = "0.1.0"
__all__ = [
    "api",
    "config",
    "main",
    "models",
    "pipeline",
    "schemas",
    "taxonomy",
]
