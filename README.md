# Atlas

**A free, open-source directory helping people discover who's working on the issues that matter most — in every community across America.**

## What is Atlas?

Across the country, thousands of organizations and individuals are working on housing, labor, climate, democracy, justice, and more. But finding them isn't easy. Information is scattered, outdated, or buried in search results.

Atlas changes that. It's a searchable, public directory powered by an AI-driven discovery engine that continuously finds and organizes information about the people and groups doing meaningful work in communities everywhere. Every entry is traced back to public sources, so you can see exactly where the information comes from.

This is a nonprofit, open-source project. To learn more about our mission and goals, see the [Product Vision](./docs/the-atlas-product.md).

## Getting Started

Whether you're a developer, researcher, organizer, or just curious — welcome. Here's how to get involved:

- **Explore the project** — Read the [Product Vision](./docs/the-atlas-product.md) to understand what we're building and why
- **Set up a development environment** — Follow the [Getting Started](./docs/getting-started/README.md) guide
- **Contribute** — Check the [Development Workflow](./docs/development/workflow.md) for how we work together

## For Developers

### Quick Start

**Prerequisites:** Python 3.12+, Node.js 24+, and Make. See [full prerequisites](./docs/getting-started/prerequisites.md).

```bash
cd atlas
make setup
pnpm dev
```

| Service  | URL                                |
|----------|------------------------------------|
| Frontend | http://app.localhost:1355          |
| API      | http://api.localhost:1355          |
| API Docs | http://api.localhost:1355/docs     |

> [!TIP]
> We use [Portless](https://github.com/vercel-labs/portless) to manage local services. It eliminates port conflicts by providing stable, named URLs for each service. Ensure your local environment variables (e.g., in `app/.env.local`) are updated to point to these URLs.

### Documentation

Contributor documentation still lives in [`docs/`](./docs/README.md), and the new Mintlify docs project lives in [`mintlify/`](./mintlify/docs.json):

| Section | Description |
|---------|-------------|
| [Getting Started](./docs/getting-started/README.md) | Installation, setup, and project orientation |
| [Architecture](./docs/architecture/README.md) | System design, data model, and pipeline |
| [Development](./docs/development/README.md) | Workflow, building features, and testing |
| [Standards](./docs/standards/README.md) | Code style, commit conventions, and API design |
| [Deployment](./docs/deployment/README.md) | Production deployment and release process |
| [Design](./docs/design/README.md) | Product vision and system design documents |

For the Mintlify API docs:

- Config: [`mintlify/docs.json`](./mintlify/docs.json)
- API pages: [`mintlify/api-reference/`](./mintlify/api-reference/)
- Local validation: `pnpm docs:validate`

### Tech Stack

- **Backend:** Python 3.12, FastAPI, SQLite (FTS5)
- **Frontend:** TanStack Start (React + TypeScript)
- **AI:** Anthropic Claude API for structured data extraction
- **DevOps:** Docker Compose, Makefile, Turborepo

### Contributing

Start with the [Getting Started](./docs/getting-started/README.md) guide, then follow the [Development Workflow](./docs/development/workflow.md) for day-to-day practices. All commits must follow the [Conventional Commits](./docs/standards/commit-messages.md) format, enforced automatically by git hooks.

## License

This project is licensed under the [MIT License](./LICENSE).
