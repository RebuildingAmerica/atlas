# Quick Start

[Docs](../README.md) > [Getting Started](./README.md) > Quick Start

Get Atlas running on your machine in 3 steps.

## Prerequisites

First, make sure you have installed:

- Python 3.12+
- Node.js 24.18+ in the 24.x line
- Make
- Git

See [Prerequisites](./prerequisites.md) if you need help with any of these.

## 3-Step Setup

### Step 1: Clone the repository

```bash
git clone https://github.com/[org]/atlas.git
cd atlas
```

### Step 2: Run bootstrap

```bash
pnpm bootstrap
```

This walks through the repo setup checklist, account confirmations, environment
values, and hosted readiness checks.

### Step 3: Start local services

```bash
pnpm dev
```

This starts both the api and app servers:

- **API:** https://api.atlas.localhost
- **App:** https://atlas.localhost
- **API reference:** https://atlas.localhost/docs/api

You should see output like:

```
Starting The Atlas...
INFO:     Uvicorn running
VITE v5.0.0  ready in 245 ms
```

## What Just Happened?

### pnpm bootstrap

1. Installs the pnpm workspace.
2. Creates and updates environment files.
3. Confirms each CLI account before using it.
4. Prompts for human-owned values and generates bootstrap-owned secrets.
5. Checks hosted readiness and billing setup.

### pnpm dev

1. Starts the FastAPI api server under `https://api.atlas.localhost`
2. Starts the Vite app development server under `https://atlas.localhost`
3. Any code changes you make will automatically reload the browser and api

## Verify It Works

Open your browser and check:

1. **App:** https://atlas.localhost
   - Should show the Atlas homepage
   - Try navigating around

2. **API reference:** https://atlas.localhost/docs/api
   - Should show the interactive Scalar reference
   - All published endpoints are listed here with schemas and request examples

3. **API (raw):** https://api.atlas.localhost/api/v1/entries
   - Should return JSON (likely empty array if database is new)

## Stop the Servers

To stop development servers, press `Ctrl+C` in your terminal.

## Next Steps

- **Understand the project:** [Project Structure](./project-structure.md)
- **Learn how the system works:** [Architecture](../architecture/README.md)
- **Start developing:** [Development Guide](../development/README.md)

## Troubleshooting

### "ModuleNotFoundError" on bootstrap

Make sure Python 3.12+ is installed and activated. Then rerun:

```bash
pnpm bootstrap
```

### "command not found: pnpm" on bootstrap

Make sure Node.js 24.18+ in the Node 24 release line is installed, then run
`npm install --global corepack@0.35.0`, `corepack enable`, and
`corepack prepare pnpm@11.10.0 --activate`. Verify with `node --version` and
`pnpm --version`.

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

Make sure you're running `make dev` (which enables hot-reload). If hot-reload
isn't working:

1. Stop the servers (Ctrl+C)
2. Run `make dev` again

---

Next: [Project Structure](./project-structure.md)
