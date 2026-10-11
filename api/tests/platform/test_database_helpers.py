"""Tests for the platform-level database delegating wrappers."""

from __future__ import annotations

import os
import re
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from atlas.platform.database import (
    DatabaseManager,
    db,
    get_db_connection,
    init_db,
)


class TestDatabaseManager:
    def test_generate_uuid_returns_uuid_format(self) -> None:
        value = DatabaseManager.generate_uuid()
        assert re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", value)

    def test_now_iso_returns_timezone_aware_iso_string(self) -> None:
        value = DatabaseManager.now_iso()
        assert "T" in value
        assert value.endswith("+00:00")

    def test_encode_decode_roundtrip(self) -> None:
        encoded = DatabaseManager.encode_json({"k": [1, 2, 3]})
        assert DatabaseManager.decode_json(encoded) == {"k": [1, 2, 3]}

    def test_module_singleton_is_a_database_manager(self) -> None:
        assert isinstance(db, DatabaseManager)


class TestPlatformDatabaseDelegation:
    @pytest.mark.asyncio
    async def test_init_and_connect_via_platform_module(self, tmp_db_path: str) -> None:
        url = f"sqlite:///{tmp_db_path}"

        await init_db(url)
        conn = await get_db_connection(url)
        try:
            cursor = await conn.execute("SELECT 1")
            row = await cursor.fetchone()
            assert row[0] == 1
        finally:
            await conn.close()


@pytest.mark.parametrize(
    "fixture_import",
    [
        pytest.param("", id="shared"),
        pytest.param(
            "from tests.domains.discovery.schedule_support import test_db",
            id="schedule-api",
        ),
        pytest.param(
            "from tests.domains.discovery.test_schedule_crud import db as test_db",
            id="schedule-crud",
        ),
        pytest.param(
            "from tests.domains.discovery.test_worker_api import test_db",
            id="worker-api",
        ),
        pytest.param(
            "from tests.domains.discovery.test_worker import db_url",
            id="discovery-worker",
        ),
        pytest.param(
            "from tests.domains.firehose.test_delivery_worker_runtime import db_url",
            id="firehose-worker",
        ),
    ],
)
@pytest.mark.parametrize(
    ("scenario", "exit_code", "summary"),
    [
        ("normal", 0, "1 passed"),
        ("test_failure", 1, "1 failed"),
        ("setup_failure", 1, "1 error"),
        ("teardown_failure", 1, "1 passed, 1 error"),
    ],
)
def test_sqlite_fixture_removes_database_after_teardown(
    tmp_path: Path, fixture_import: str, scenario: str, exit_code: int, summary: str
) -> None:
    """Fixture databases and sidecars must not survive successful or failed tests."""
    system_temp = tmp_path / "system-temp"
    system_temp.mkdir()
    unrelated_db = system_temp / "unrelated.db"
    unrelated_db.write_bytes(b"preserve other tests' databases")
    (tmp_path / "conftest.py").write_text(
        textwrap.dedent(
            f"""\
            from pathlib import Path

            import pytest

            from tests.conftest import db_url, test_db, tmp_db_path
            {fixture_import}

            scenario = {scenario!r}

            @pytest.fixture
            def recorded_database(tmp_db_path):
                path = Path(tmp_db_path)
                Path("database-path.txt").write_text(str(path))
                yield path
                # test_db has closed by now. Leave sidecars behind to ensure
                # fixture cleanup also covers an interrupted SQLite checkpoint.
                for suffix in ("-wal", "-shm", "-journal"):
                    Path(str(path) + suffix).write_bytes(b"leftover sidecar")
                if scenario == "teardown_failure":
                    raise RuntimeError("fixture teardown failed")

            @pytest.fixture
            def scenario_setup(test_db):
                if scenario == "setup_failure":
                    raise RuntimeError("fixture setup failed")
            """
        )
    )
    (tmp_path / "test_fixture.py").write_text(
        textwrap.dedent(
            f"""\
            import pytest

            @pytest.mark.asyncio
            async def test_database(recorded_database, test_db, scenario_setup):
                assert recorded_database.is_file()
                cursor = await test_db.execute(
                    "SELECT name FROM sqlite_master WHERE name = 'entries'"
                )
                assert (await cursor.fetchone())[0] == "entries"
                await cursor.close()
                if {scenario!r} == "test_failure":
                    raise RuntimeError("test body failed")
            """
        )
    )
    api_root = Path(__file__).resolve().parents[2]
    environment = os.environ.copy()
    environment.update(
        TMPDIR=str(system_temp),
        TMP=str(system_temp),
        TEMP=str(system_temp),
        PYTHONPATH=os.pathsep.join(
            [
                str(api_root),
                str(api_root.parent / "libs/shared/src"),
                str(api_root.parent / "libs/discovery-engine/src"),
            ]
        ),
        ATLAS_TEST_BACKEND="sqlite",
    )
    environment.pop("ATLAS_TEST_POSTGRES_URL", None)
    environment.pop("PYTEST_ADDOPTS", None)
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "-q",
            "--color=no",
            "-o",
            "addopts=",
            "-o",
            "asyncio_mode=auto",
            "test_fixture.py",
        ],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    output = result.stdout + result.stderr
    assert result.returncode == exit_code, output
    assert summary in output, output
    database_path = Path((tmp_path / "database-path.txt").read_text())
    assert not database_path.exists()
    for suffix in ("-wal", "-shm", "-journal"):
        assert not Path(str(database_path) + suffix).exists()
    assert not database_path.parent.exists()
    assert unrelated_db.read_bytes() == b"preserve other tests' databases"
    assert set(system_temp.iterdir()) == {unrelated_db}
