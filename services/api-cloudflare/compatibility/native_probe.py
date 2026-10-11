"""Exercise native dependencies against existing Atlas discovery examples."""

import inflate64
import probablepeople


def native_checks():
    payload = b"<Return>" + b"trustee " * 500 + b"</Return>"
    compressor = inflate64.Deflater()
    compressed = compressor.deflate(payload) + compressor.flush()
    decoded = inflate64.Inflater().inflate(compressed)
    names = ("Sarah Stone", "BANK OF AMERICA N A", "Sarah Stone until fall 2024")
    return {
        "deflate64_decoded": decoded == payload,
        "decoded_bytes": len(decoded),
        "name_types": {name: probablepeople.tag(name)[1] for name in names},
    }
