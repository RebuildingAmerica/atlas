"""Location-specific query enrichment for discovery."""

LOCAL_CONTEXT: dict[str, dict[str, list[str] | str]] = {
    "Kansas City, MO": {
        "outlets": ["Kansas City Star", "KCUR", "The Beacon"],
        "transit_authority": "KCATA",
        "universities": ["UMKC", "University of Kansas"],
        "regional_terms": ["KC metro", "Johnson County"],
    }
}

