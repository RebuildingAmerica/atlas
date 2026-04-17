# Quick Start

[Docs](../README.md) > [Getting Started](./README.md) > Quick Start

Get The Atlas running on your machine in 4 steps.

## Prerequisites

First, make sure you have installed:
- Python 3.12+
- Node.js 24+
- Make
- Git

See [Prerequisites](./prerequisites.md) if you need help with any of these.

## 4-Step Setup

### Step 1: Clone the repository

```bash
git clone https://github.com/[org]/atlas.git
cd atlas
```

### Step 2: Copy environment file

```bash
cp .env.example .env
```

This creates a local `.env` file with default configuration. You can edit it if needed, but defaults work for local development.

### Step 3: Run setup

```bash
make setup
```

This command:
- Installs Python api dependencies
- Installs Node.js app dependencies
- Initializes the SQLite database with schema

Takes about 2-3 minutes on first run.

### Step 4: Start development

```bash
make dev
```

This starts both the api and app servers:
- **Backend API:** http://localhost:8000
- **Frontend:** http://localhost:3000
- **API Docs (Swagger):** http://localhost:8000/docs

You should see output like:
```
Starting The Atlas...
INFO:     Uvicorn running on http://0.0.0.0:8000
VITE v5.0.0  ready in 245 ms
```

## What Just Happened?

### make setup
1. Copies `.env.example` to `.env` (local configuration)
2. Installs Python dependencies in `api/` (FastAPI, SQLite tools, testing frameworks)
3. Installs Node.js dependencies in `app/` (React, TanStack Start, build tools)
4. Initializes SQLite database with schema (creates `atlas.db`)

### make dev
1. Starts the FastAPI api server on port 8000 with hot-reload enabled
2. Starts the Vite app development server on port 3000 with hot-reload enabled
3. Any code changes you make will automatically reload the browser and api

## Verify It Works

Open your browser and check:

1. **Frontend:** http://localhost:3000
   - Should show the Atlas homepage
   - Try navigating around

2. **Backend API:** http://localhost:8000/docs
   - Should show interactive Swagger documentation
   - All endpoints are listed here with test buttons

3. **API (raw):** http://localhost:8000/api/v1/entries
   - Should return JSON (likely empty array if database is new)

## Stop the Servers

To stop development servers, press `Ctrl+C` in your terminal.

## Next Steps

- **Understand the project:** [Project Structure](./project-structure.md)
- **Learn how the system works:** [Architecture](../architecture/README.md)
- **Start developing:** [Development Guide](../development/README.md)

## Troubleshooting

### "ModuleNotFoundError" on make setup
Make sure Python 3.12+ is installed and activated. Try:
```bash
cd api && pip install -e ".[dev]" --break-system-packages
cd ..
```

### "command not found: pnpm" on make setup
Make sure Node.js 24+ is installed and run `corepack enable`. Verify with `node --version` and `pnpm --version`.

### Port 8000 or 3000 already in use
Kill the process using the port, or change the port in the start commands:
```bash
cd api && uvicorn atlas.main:app --reload --host 0.0.0.0 --port 8001
cd app && pnpm run dev -- --port 3001
```

### Database errors
Try resetting the database:
```bash
make db-reset
```

### Changes not reflecting
Make sure you're running `make dev` (which enables hot-reload). If hot-reload isn't working:
1. Stop the servers (Ctrl+C)
2. Run `make dev` again

---

Next: [Project Structure](./project-structure.md)
