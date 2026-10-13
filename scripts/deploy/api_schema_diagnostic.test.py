"""Keep failed schema releases actionable without exposing database details."""

import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location(
    "schema_release", Path(__file__).with_name("api_schema_release.py")
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SchemaDiagnosticTests(unittest.TestCase):
    def test_sqlstate_and_phase_are_safe_without_exception_text(self):
        import psycopg

        error = psycopg.errors.QueryCanceled("private database and query text")
        self.assertEqual(
            MODULE.failure_diagnostic(error, "schema-apply"),
            {
                "schemaRelease": "failed",
                "phase": "schema-apply",
                "errorType": "QueryCanceled",
                "sqlstate": "57014",
            },
        )

    def test_unknown_exception_metadata_is_never_published(self):
        error_type = type("PrivateDatabaseName", (Exception,), {"sqlstate": "secret"})
        self.assertEqual(
            MODULE.failure_diagnostic(error_type("private detail"), "private phase"),
            {
                "schemaRelease": "failed",
                "phase": "unknown",
                "errorType": "Error",
                "sqlstate": None,
            },
        )


if __name__ == "__main__":
    unittest.main()
