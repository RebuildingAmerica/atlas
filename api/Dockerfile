FROM python:3.12-slim AS builder

WORKDIR /app

RUN pip install uv --no-cache-dir

COPY pyproject.toml uv.lock ./
RUN uv pip install --system --no-cache-dir .

COPY . .

FROM python:3.12-slim

WORKDIR /app

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin/uvicorn /usr/local/bin/uvicorn
COPY --from=builder /app/atlas ./atlas

EXPOSE 8000

CMD ["uvicorn", "atlas.main:app", "--host", "0.0.0.0", "--port", "8000"]
