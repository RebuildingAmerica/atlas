"""Article corpus collection, storage, and export for Scout.

Every submodule here is imported by its fully-qualified path
(``atlas_scout.articles.crawl_commands``, etc.) rather than through this
facade — this file only re-exports the two names genuinely consumed from
outside the package.
"""

from __future__ import annotations

from atlas_scout.articles.discovery_records import discovery_articles_from_resource
from atlas_scout.articles.records import is_article_utility_page

__all__ = ["discovery_articles_from_resource", "is_article_utility_page"]
