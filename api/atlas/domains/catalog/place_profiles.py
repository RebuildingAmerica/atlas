"""Structured place profile seed data for Atlas."""

PLACE_PROFILES: dict[str, dict[str, object]] = {
    "gary-in": {
        "demographics": {
            "population": 67324,
            "median_age": 38.7,
            "race_ethnicity": {
                "black": 0.76,
                "white": 0.12,
                "latino": 0.11,
                "other": 0.01,
            },
        },
        "economics": {
            "median_household_income": 36785,
            "poverty_rate": 0.29,
            "unemployment_rate": 0.09,
        },
        "housing": {
            "median_rent": 959,
            "rent_burden_rate": 0.47,
            "owner_occupied_rate": 0.52,
        },
        "education": {
            "bachelors_or_higher_rate": 0.15,
            "high_school_or_higher_rate": 0.86,
        },
        "health": {
            "uninsured_rate": 0.12,
        },
        "provenance": [
            {
                "dataset": "American Community Survey 5-year estimates",
                "year": 2023,
                "publisher": "U.S. Census Bureau",
            }
        ],
    }
}
