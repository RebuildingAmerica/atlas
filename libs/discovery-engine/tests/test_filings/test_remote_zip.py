"""Reading one member out of a zip served over HTTP byte ranges."""

from __future__ import annotations

import zipfile

import httpx
import pytest

from atlas_discovery_engine.remote_zip import (
    RemoteMember,
    RemoteZipError,
    UnsupportedCompressionError,
    read_central_directory,
    read_member,
)

from .support import (
    FakeHost,
    build_deflate64_zip,
    build_zip,
    build_zip64,
    with_directory_field,
)

pytestmark = pytest.mark.asyncio

ARCHIVE = "https://apps.irs.gov/pub/epostcard/990/xml/2025/2025_TEOS_XML_01A.zip"


class TestReadCentralDirectory:
    async def test_lists_only_the_members_it_was_asked_for(self) -> None:
        """A 150,000-entry directory must not become 150,000 objects."""
        host = FakeHost(archives={ARCHIVE: build_zip({"a_public.xml": b"a", "b_public.xml": b"b"})})

        async with host.client() as client:
            members = await read_central_directory(client, ARCHIVE, {"b_public.xml"}.__contains__)

        assert list(members) == ["b_public.xml"]
        assert members["b_public.xml"].url == ARCHIVE

    async def test_keys_members_by_base_name(self) -> None:
        """IRS batches nest returns in a folder; lookups use the bare file name."""
        host = FakeHost(archives={ARCHIVE: build_zip({"2025_TEOS_XML_01A/x_public.xml": b"x"})})

        async with host.client() as client:
            members = await read_central_directory(client, ARCHIVE, lambda _name: True)

        assert list(members) == ["x_public.xml"]

    async def test_follows_the_zip64_record_of_a_very_large_archive(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The larger monthly batches overflow the classic member count."""
        host = FakeHost(archives={ARCHIVE: build_zip64({"a": b"1", "b": b"2"}, monkeypatch)})

        async with host.client() as client:
            members = await read_central_directory(client, ARCHIVE, lambda _name: True)

        assert sorted(members) == ["a", "b"]

    async def test_rejects_bytes_that_are_not_a_zip(self) -> None:
        """A host that serves an error page in place of the archive fails loudly."""
        host = FakeHost(archives={ARCHIVE: b"<html>not found</html>"})

        async with host.client() as client:
            with pytest.raises(RemoteZipError, match="end-of-directory"):
                await read_central_directory(client, ARCHIVE, lambda _name: True)

    @pytest.mark.parametrize("field_offset", [20, 42], ids=["compressed_size", "offset"])
    async def test_refuses_a_member_whose_fields_overflow_into_zip64(
        self, field_offset: int
    ) -> None:
        """Reading from a placeholder offset would return bytes from the wrong member."""
        archive = with_directory_field(build_zip({"r_public.xml": b"x"}), field_offset, 0xFFFFFFFF)
        host = FakeHost(archives={ARCHIVE: archive})

        async with host.client() as client:
            with pytest.raises(RemoteZipError, match="zip64 member fields"):
                await read_central_directory(client, ARCHIVE, lambda _name: True)

    async def test_refuses_an_archive_whose_size_is_not_reported(self) -> None:
        """Without a length there is no way to find the directory at the end."""
        host = FakeHost(archives={ARCHIVE: build_zip({"a": b"1"})}, unsized={ARCHIVE})

        async with host.client() as client:
            with pytest.raises(RemoteZipError, match="did not report its size"):
                await read_central_directory(client, ARCHIVE, lambda _name: True)

    async def test_refuses_a_truncated_directory_record(self) -> None:
        """An end record cut short is a broken archive, not a crash."""
        archive = build_zip({"a": b"1"})
        host = FakeHost(archives={ARCHIVE: archive[: archive.rfind(b"PK\x05\x06") + 12]})

        async with host.client() as client:
            with pytest.raises(RemoteZipError, match="truncated directory"):
                await read_central_directory(client, ARCHIVE, lambda _name: True)

    async def test_raises_when_the_host_refuses_the_archive(self) -> None:
        """A missing archive surfaces as an HTTP error for the caller to skip."""
        host = FakeHost()

        async with host.client() as client:
            with pytest.raises(httpx.HTTPStatusError):
                await read_central_directory(client, ARCHIVE, lambda _name: True)


class TestReadMember:
    async def test_inflates_a_deflated_member(self) -> None:
        """IRS returns are deflated inside each batch."""
        payload = b"<Return>" + b"officer " * 500 + b"</Return>"
        host = FakeHost(archives={ARCHIVE: build_zip({"r_public.xml": payload})})

        async with host.client() as client:
            members = await read_central_directory(client, ARCHIVE, lambda _name: True)
            assert await read_member(client, members["r_public.xml"]) == payload

    async def test_returns_a_stored_member_unchanged(self) -> None:
        """A member written without compression needs no inflating."""
        host = FakeHost(
            archives={ARCHIVE: build_zip({"s_public.xml": b"plain"}, stored=("s_public.xml",))}
        )

        async with host.client() as client:
            members = await read_central_directory(client, ARCHIVE, lambda _name: True)
            assert await read_member(client, members["s_public.xml"]) == b"plain"

    async def test_inflates_a_deflate64_member(self) -> None:
        """The IRS's newer batches use Deflate64, which zlib cannot read."""
        payload = b"<Return>" + b"trustee " * 500 + b"</Return>"
        host = FakeHost(archives={ARCHIVE: build_deflate64_zip("d_public.xml", payload)})

        async with host.client() as client:
            members = await read_central_directory(client, ARCHIVE, lambda _name: True)
            assert members["d_public.xml"].method == 9
            assert await read_member(client, members["d_public.xml"]) == payload

    async def test_refuses_a_compression_method_it_cannot_inflate(self) -> None:
        """Returning still-compressed bytes would look like a corrupt document."""
        buffer = build_zip({"b_public.xml": b"data" * 100})
        host = FakeHost(archives={ARCHIVE: _rezip(buffer, zipfile.ZIP_BZIP2)})

        async with host.client() as client:
            members = await read_central_directory(client, ARCHIVE, lambda _name: True)
            with pytest.raises(UnsupportedCompressionError, match="method 12"):
                await read_member(client, members["b_public.xml"])

    @pytest.mark.parametrize("method", [8, 9], ids=["deflate", "deflate64"])
    async def test_refuses_a_member_that_does_not_inflate(self, method: int) -> None:
        """A corrupt return is skipped by the caller rather than ending its run."""
        host = FakeHost(archives={ARCHIVE: build_zip({"c": b"\xff" * 64}, stored=("c",))})

        async with host.client() as client:
            members = await read_central_directory(client, ARCHIVE, lambda _name: True)
            corrupt = RemoteMember(
                ARCHIVE, members["c"].offset, members["c"].compressed_size, method
            )
            with pytest.raises(RemoteZipError, match="does not inflate"):
                await read_member(client, corrupt)

    async def test_refuses_a_member_whose_local_header_is_cut_short(self) -> None:
        """An offset past the archive's end reads no header at all."""
        archive = build_zip({"a": b"1"})
        host = FakeHost(archives={ARCHIVE: archive})

        async with host.client() as client:
            with pytest.raises(RemoteZipError, match="truncated header"):
                await read_member(client, RemoteMember(ARCHIVE, len(archive) - 4, 1, 0))

    async def test_raises_when_a_range_request_fails(self) -> None:
        """A range the host refuses is an HTTP error, not silently empty bytes."""
        host = FakeHost(archives={ARCHIVE: build_zip({"r": b"data"})})

        async with host.client() as client:
            members = await read_central_directory(client, ARCHIVE, lambda _name: True)
            host.failing_ranges.add(ARCHIVE)
            with pytest.raises(httpx.HTTPStatusError):
                await read_member(client, members["r"])


def _rezip(archive: bytes, method: int) -> bytes:
    """Rewrite every member of ``archive`` with compression ``method``."""
    import io

    source = zipfile.ZipFile(io.BytesIO(archive))
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w", compression=method) as out:
        for info in source.infolist():
            out.writestr(info.filename, source.read(info))
    return target.getvalue()
