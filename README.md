# Atlas

**A public, source-linked directory of civic actors and the work they do in the
United States.**

Atlas helps users search by place, issue, organization, person, initiative, or
civic concern to find who is working on public problems throughout the country.
It connects each record to public sources, so researchers, journalists,
organizers, developers, and residents can inspect the evidence before using the
information.

Visit Atlas at [atlas.rebuildingus.org](https://atlas.rebuildingus.org).

## Why Atlas Exists

Public-interest work is everywhere, but it is hard to find. Useful information
is split across local news, organization websites, public meetings, nonprofit
directories, government records, research reports, podcasts, campaign pages, and
other public sources.

Atlas turns that scattered information into records that can be searched,
filtered, reviewed, corrected, exported, and used through an API. A profile is
useful only when it shows the actor, the place, the issue context, and the
source evidence clearly enough for a human to decide what to do next.

## What Atlas Includes

- **Public discovery:** Search and browse for people, organizations,
  initiatives, campaigns, events, places, and issue areas.
- **Trust and provenance:** Source titles, URLs, dates, excerpts, freshness,
  confidence, corrections, and clear public/private boundaries.
- **Developer access:** REST API, OpenAPI, MCP, Scout, and self-hosting paths
  for building on the same source-linked data.
- **Workspace tools:** Lists, briefs, watches, exports, and coverage workflows
  for teams that need to turn discovery into reusable work.

The public map is the center of the project. Hosted and workspace features
should strengthen that public civic discovery experience, not replace it.

## Using Atlas

The usage docs are published at
[atlas.rebuildingus.org/docs](https://atlas.rebuildingus.org/docs). Start there
if you want to browse Atlas, understand the data model, use the API, connect an
AI assistant, run Scout, or self-host an instance.

| Need                             | Public Docs                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------- |
| Understand the product           | [Platform overview](https://atlas.rebuildingus.org/docs/what-is-atlas)       |
| Browse the public directory      | [Browse walkthrough](https://atlas.rebuildingus.org/docs/quickstart-browse)  |
| Interpret sources and confidence | [Trust and provenance](https://atlas.rebuildingus.org/docs/resources/trust)  |
| Use the API                      | [API guide](https://atlas.rebuildingus.org/docs/api)                         |
| Connect MCP or agents            | [MCP overview](https://atlas.rebuildingus.org/docs/mcp/overview)             |
| Run Scout                        | [Scout overview](https://atlas.rebuildingus.org/docs/scout/overview)         |
| Self-host Atlas                  | [Self-hosting guide](https://atlas.rebuildingus.org/docs/self-hosting/guide) |

## Working On This Repo

Use the repo docs when you are setting up a development environment, changing
code, reviewing architecture, or checking project standards.

| Need                            | Repo Docs                                                        |
| ------------------------------- | ---------------------------------------------------------------- |
| Run the project locally         | [Getting Started](./docs/getting-started/README.md)              |
| Understand the codebase         | [Project Structure](./docs/getting-started/project-structure.md) |
| Follow the development workflow | [Development Workflow](./docs/development/workflow.md)           |
| Understand architecture         | [Architecture](./docs/architecture/README.md)                    |
| Follow code and docs standards  | [Standards](./docs/standards/README.md)                          |

If you edit the public docs site, validate it from the repo root:

```bash
pnpm docs:validate
```

## Run Locally

**Prerequisites:** Python 3.12+, Node.js 24.18+ in the Node 24 release line,
Corepack/pnpm, Git, and Make. See
[full prerequisites](./docs/getting-started/prerequisites.md).

```bash
git clone https://github.com/RebuildingAmerica/atlas.git
cd atlas
make setup
pnpm dev
```

| Service  | Local URL                        |
| -------- | -------------------------------- |
| App      | https://atlas.localhost          |
| API      | https://api.atlas.localhost      |
| API docs | https://atlas.localhost/docs/api |

The local stack uses [Portless](https://github.com/vercel-labs/portless) for
stable HTTPS URLs. The development docs include app-only and API-only commands
for environments where running the full stack is not the right first step.

## Repository Map

| Path                        | Purpose                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| [`app/`](./app/README.md)   | TanStack Start + React app for public discovery and workspace surfaces |
| [`api/`](./api/README.md)   | FastAPI service, catalog domains, discovery jobs, and public API       |
| [`scout/`](./scout/)        | Local discovery CLI and review/sync workflow                           |
| [`libs/`](./libs/)          | Shared Python models, taxonomy, and discovery engine primitives        |
| [`mintlify/`](./mintlify/)  | Source for the public docs site                                        |
| [`docs/`](./docs/README.md) | Contributor, architecture, product, deployment, and standards docs     |

## Contributing

Contributors are welcome. Atlas is developed like civic infrastructure: changes
should be source-conscious, easy to verify, respectful of the people represented
in the directory, and useful to someone trying to understand public work.

Start with [CONTRIBUTORS.md](./CONTRIBUTORS.md) for contribution guidance.

## License

Atlas is released under the MIT License. You may use, copy, modify, merge,
publish, distribute, sublicense, and sell copies of the software, subject to the
terms in [LICENSE](./LICENSE).
