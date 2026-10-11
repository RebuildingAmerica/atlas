"""Exercise native dependencies against existing Atlas discovery examples."""

def archive_checks():
    import inflate64

    payload = b"<Return>" + b"trustee " * 500 + b"</Return>"
    compressor = inflate64.Deflater()
    compressed = compressor.deflate(payload) + compressor.flush()
    decoded = inflate64.Inflater().inflate(compressed)
    return {
        "deflate64_decoded": decoded == payload,
        "decoded_bytes": len(decoded),
    }


def name_checks():
    import probablepeople

    names = ("Sarah Stone", "BANK OF AMERICA N A", "Sarah Stone until fall 2024")
    return {"name_types": {name: probablepeople.tag(name)[1] for name in names}}


def native_checks():
    return {**archive_checks(), **name_checks()}
