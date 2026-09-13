"""Read single members out of a zip archive served over HTTP.

The IRS publishes every electronically filed Form 990 inside archives of about
100 MB each, and a discovery run needs a few hundred filings, not a few
gigabytes. A zip keeps its directory at the end of the file and each member at
a known offset, and the IRS host honours byte ranges, so one filing costs a
directory read per archive and two small range requests.

The standard library's ``zipfile`` can read a remote archive through a
seekable range-reading file, and it was measured before this module was
written. On the largest IRS batch, 156,228 members, ``zipfile`` built an object
per member: 15.5 seconds to open, 94 MB of heap and a 111 MB peak. A run reads
the directories of roughly 40 archives, and the durable worker holds a job for
a 900-second lease, so ``zipfile`` alone would spend most of that lease opening
archives. Filtering the directory while walking it keeps only the returns a run
asked for, and the same archive opens in 0.8 seconds. That constraint is why
the directory is walked by hand here; decompression still goes through zlib and
inflate64.
"""

from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass
from typing import TYPE_CHECKING

import inflate64

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx

__all__ = [
    "RemoteMember",
    "RemoteZipError",
    "UnsupportedCompressionError",
    "read_central_directory",
    "read_member",
]

_EOCD_SIGNATURE = b"PK\x05\x06"
_ZIP64_LOCATOR_SIGNATURE = b"PK\x06\x07"
_DIRECTORY_ENTRY_SIGNATURE = b"PK\x01\x02"
_EOCD_SIZE = 22
_MAX_COMMENT = 65535
_DIRECTORY_ENTRY_SIZE = 46
_LOCAL_HEADER_SIZE = 30
_STORED = 0
_DEFLATED = 8
# The IRS compresses its newer, larger batches with Deflate64, which zlib
# cannot inflate.
_DEFLATE64 = 9
_ZIP64_ENTRY_COUNT = 0xFFFF
_ZIP64_FIELD = 0xFFFFFFFF


class RemoteZipError(ValueError):
    """The bytes served are not a readable zip, or a member will not inflate.

    Callers skip the archive or member and carry on, so every format failure
    surfaces as this one type rather than whichever of struct, zlib or
    inflate64 noticed first.
    """


class UnsupportedCompressionError(RemoteZipError):
    """A member uses a compression method this reader cannot inflate."""


@dataclass(frozen=True)
class RemoteMember:
    """Where one archive member's bytes live inside a remote zip."""

    url: str
    """The archive holding the member."""

    offset: int
    """Byte offset of the member's local header."""

    compressed_size: int
    """Length of the member's stored bytes."""

    method: int
    """Zip compression method: 0 stored, 8 deflate, 9 Deflate64."""


async def read_central_directory(
    client: httpx.AsyncClient,
    url: str,
    wanted: Callable[[str], bool],
) -> dict[str, RemoteMember]:
    """List the members of a remote zip whose names ``wanted`` accepts.

    Parameters
    ----------
    client : httpx.AsyncClient
        Client used for the range requests.
    url : str
        Address of the archive.
    wanted : Callable[[str], bool]
        Predicate over a member's base name. Filtering here keeps a directory
        of 150,000 entries from becoming 150,000 objects in memory.

    Returns
    -------
    dict[str, RemoteMember]
        Accepted members keyed by base name.

    Raises
    ------
    httpx.HTTPError
        When the host refuses a request.
    RemoteZipError
        When the bytes are not a zip directory the reader can walk.
    """
    head = await client.head(url)
    head.raise_for_status()
    length = head.headers.get("content-length", "")
    if not length.isdigit():
        msg = f"{url} did not report its size, so its directory cannot be located"
        raise RemoteZipError(msg)
    size = int(length)
    tail = await _range(client, url, max(0, size - _EOCD_SIZE - _MAX_COMMENT), size - 1)

    eocd = tail.rfind(_EOCD_SIGNATURE)
    if eocd < 0:
        msg = f"{url} has no end-of-directory record"
        raise RemoteZipError(msg)
    try:
        entries, directory_size, directory_offset = struct.unpack("<10xHII", tail[eocd : eocd + 20])
        # An archive with more than 65,535 members stores its real counts in a
        # zip64 record, which is the case for the larger IRS monthly batches.
        if entries == _ZIP64_ENTRY_COUNT:
            locator = tail.rfind(_ZIP64_LOCATOR_SIGNATURE)
            (record_offset,) = struct.unpack("<Q", tail[locator + 8 : locator + 16])
            record = await _range(client, url, record_offset, record_offset + 55)
            directory_size, directory_offset = struct.unpack("<QQ", record[40:56])
        directory = await _range(
            client, url, directory_offset, directory_offset + directory_size - 1
        )
        return _parse_directory(directory, url, wanted)
    except struct.error as error:
        msg = f"{url} has a truncated directory record"
        raise RemoteZipError(msg) from error


async def read_member(client: httpx.AsyncClient, member: RemoteMember) -> bytes:
    """Fetch and decompress one member of a remote zip.

    Parameters
    ----------
    client : httpx.AsyncClient
        Client used for the range requests.
    member : RemoteMember
        The member, as ``read_central_directory`` located it.

    Returns
    -------
    bytes
        The member's uncompressed contents.

    Raises
    ------
    httpx.HTTPError
        When the host refuses a request.
    UnsupportedCompressionError
        When the member uses a method other than stored, deflate or Deflate64.
        Returning the compressed bytes instead would hand a caller garbage
        that looks like a document.
    RemoteZipError
        When the local header is truncated or the stored bytes do not inflate.
    """
    if member.method not in (_STORED, _DEFLATED, _DEFLATE64):
        msg = f"compression method {member.method} is not supported"
        raise UnsupportedCompressionError(msg)
    header_end = member.offset + _LOCAL_HEADER_SIZE - 1
    header = await _range(client, member.url, member.offset, header_end)
    try:
        name_length, extra_length = struct.unpack("<HH", header[26:30])
    except struct.error as error:
        msg = f"member at offset {member.offset} of {member.url} has a truncated header"
        raise RemoteZipError(msg) from error
    start = member.offset + _LOCAL_HEADER_SIZE + name_length + extra_length
    raw = await _range(client, member.url, start, start + member.compressed_size - 1)
    try:
        if member.method == _DEFLATED:
            return zlib.decompress(raw, -zlib.MAX_WBITS)
        if member.method == _DEFLATE64:
            return inflate64.Inflater().inflate(raw)
    except (zlib.error, ValueError) as error:
        msg = f"member at offset {member.offset} of {member.url} does not inflate"
        raise RemoteZipError(msg) from error
    return raw


def _parse_directory(
    directory: bytes,
    url: str,
    wanted: Callable[[str], bool],
) -> dict[str, RemoteMember]:
    """Walk central directory entries, keeping the ones ``wanted`` accepts."""
    members: dict[str, RemoteMember] = {}
    position = 0
    while directory[position : position + 4] == _DIRECTORY_ENTRY_SIGNATURE:
        fixed = directory[position : position + _DIRECTORY_ENTRY_SIZE]
        (method,) = struct.unpack("<H", fixed[10:12])
        (compressed_size,) = struct.unpack("<I", fixed[20:24])
        name_length, extra_length, comment_length = struct.unpack("<HHH", fixed[28:34])
        (offset,) = struct.unpack("<I", fixed[42:46])
        name_start = position + _DIRECTORY_ENTRY_SIZE
        name = directory[name_start : name_start + name_length].decode("utf-8", "replace")
        base_name = name.rsplit("/", 1)[-1]
        if wanted(base_name):
            # A member past 4 GB moves its offset into a zip64 extra field. The
            # largest IRS archive is 1.1 GB, so this has never happened; if it
            # does, fail rather than read from a meaningless offset.
            if _ZIP64_FIELD in (offset, compressed_size):
                msg = f"{base_name} in {url} needs zip64 member fields"
                raise RemoteZipError(msg)
            members[base_name] = RemoteMember(url, offset, compressed_size, method)
        position = name_start + name_length + extra_length + comment_length
    return members


async def _range(client: httpx.AsyncClient, url: str, start: int, end: int) -> bytes:
    """Fetch the inclusive byte range [start, end] of ``url``."""
    response = await client.get(url, headers={"Range": f"bytes={start}-{end}"})
    response.raise_for_status()
    return response.content
