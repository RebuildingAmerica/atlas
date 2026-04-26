FROM python:3.12-slim AS builder

WORKDIR /build

# Copy shared libraries first (these are dependencies)
COPY libs/shared libs/shared
COPY libs/discovery-engine libs/discovery-engine

# Copy the API package
COPY api/pyproject.toml api/README.md api/uv.lock api/
COPY api/atlas api/atlas

# Install from the api directory — pip resolves ../libs/* path deps
WORKDIR /build/api
RUN pip install --no-cache-dir .

FROM python:3.12-slim

WORKDIR /app

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin/uvicorn /usr/local/bin/uvicorn
COPY --from=builder /build/api/atlas ./atlas

EXPOSE 8000

CMD ["uvicorn", "atlas.main:app", "--host", "0.0.0.0", "--port", "8000"]
