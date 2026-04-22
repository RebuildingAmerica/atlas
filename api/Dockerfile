FROM python:3.12-slim AS builder

WORKDIR /app

COPY pyproject.toml README.md uv.lock ./
COPY atlas ./atlas
RUN pip install --no-cache-dir .

FROM python:3.12-slim

WORKDIR /app

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin/uvicorn /usr/local/bin/uvicorn
COPY --from=builder /app/atlas ./atlas

EXPOSE 8000

CMD ["uvicorn", "atlas.main:app", "--host", "0.0.0.0", "--port", "8000"]
