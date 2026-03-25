# The Atlas - Frontend

A TanStack Start-based React frontend for The Atlas infrastructure discovery and cataloging platform.

## Project Structure

```
frontend/
├── src/
│   ├── routes/              # TanStack Router file-based routes
│   │   ├── __root.tsx       # Root layout with navigation
│   │   ├── index.tsx        # Dashboard page
│   │   ├── atlas.tsx        # Entry browser page
│   │   ├── atlas.$entryId.tsx    # Entry detail page
│   │   └── discovery.tsx    # Discovery console page
│   ├── components/
│   │   ├── ui/              # Reusable UI components (button, input, card, etc.)
│   │   ├── layout/          # Layout components
│   │   ├── entries/         # Entry-specific components
│   │   └── discovery/       # Discovery-specific components
│   ├── hooks/               # Custom React Query hooks
│   ├── lib/                 # Utilities (API client, helpers)
│   ├── types/               # TypeScript type definitions
│   ├── styles/              # Global CSS (Tailwind)
│   ├── router.tsx           # Router configuration
│   ├── entry.client.tsx     # Client entry point
│   ├── entry.server.tsx     # Server entry point
│   └── routeTree.gen.ts     # Auto-generated route tree
├── app.config.ts            # TanStack Start configuration
├── vite.config.ts           # Vite configuration
├── tsconfig.json            # TypeScript configuration
├── eslint.config.js         # ESLint configuration
├── .prettierrc.json         # Prettier configuration
└── tailwind.config.js       # Tailwind CSS configuration
```

## Features

### Pages

- **Dashboard** (`/`) - Overview of entries, issue areas, and key metrics
- **Browse** (`/atlas`) - Searchable, filterable entry catalog with public SEO
- **Entry Detail** (`/atlas/{entryId}`) - Full entry information with scoring
- **Discovery Console** (`/discovery`) - Start discovery runs, monitor progress

### Components

- **Reusable UI** - Button, Input, Select, Badge, Card, Spinner
- **Entry Views** - Cards, filters, list, and detail components
- **Discovery Forms** - Run configuration and status monitoring
- **Navigation** - Header with links to main sections

### State Management

- **React Query** - Data fetching, caching, and synchronization
- **Local State** - React hooks for filters and form data
- **Optimistic Updates** - Discovery mutation with automatic list refresh

## Development

### Installation

```bash
npm install
```

### Development Server

```bash
npm run dev
```

Starts the dev server at `http://localhost:5173` with hot module replacement.

### Quality Checks

```bash
npm run typecheck  # Type checking
npm run lint       # ESLint
npm run format     # Prettier formatting
npm run quality    # All checks combined
```

### Build

```bash
npm run build
```

Builds the production bundle (output in `.output/`).

### Docker Build

```bash
docker build -t atlas-frontend .
docker run -p 3000:3000 atlas-frontend
```

## Architecture

### Server-Side Rendering (SSR)

- Default: **SPA mode** (no SSR) for internal pages (`/`, `/discovery`)
- Public pages enable SSR for SEO and link previewing (`/atlas`, `/atlas/{entryId}`)
- Configurable per-route with `ssr: true/false` in route definition

### API Integration

The frontend communicates with the backend at `/api/v1`:

- **Entries**: List, filter, and fetch individual entries
- **Discovery**: Start runs, poll status, list run history
- **Taxonomy**: Fetch issue areas for filtering

See `src/lib/api.ts` for typed API wrapper.

### Styling

Uses **Tailwind CSS v4** with:
- Utility-first CSS
- Custom color palette
- Responsive design patterns
- Built with `@tailwindcss/vite` for fast dev builds

### Code Organization

- **Colocated** - Components with related logic stay together
- **Type-safe** - Full TypeScript with strict mode enabled
- **Modular** - Reusable hooks and components with clear boundaries
- **Tested-ready** - Structure supports unit and integration tests

## Development Standards

### TypeScript

- Strict mode enabled
- No `any` types (auto-fixing in eslint)
- Type imports for cleaner code
- Proper error type unions

### Code Style

- ESLint for code quality (max-warnings: 0)
- Prettier for consistent formatting
- Consistent naming conventions

### React Practices

- Functional components with hooks
- React Query for data fetching
- Suspense-ready architecture
- Accessible HTML semantics

## Environment Variables

None required for development (proxied to `http://localhost:8000/api`).

For production, configure the API base URL in `src/lib/api.ts` or add env support.

## Troubleshooting

### Build Errors

Ensure all files pass quality checks:

```bash
npm run quality
```

### Type Errors

Regenerate types if backend schema changes:

```bash
npm run typecheck
```

### Missing Dependencies

Clear node_modules and reinstall:

```bash
rm -rf node_modules package-lock.json
npm install
```

## Deployment

The frontend is designed to be deployed as a Docker container or static build.

### Docker Deployment

```bash
docker build -t atlas-frontend .
docker run -p 3000:3000 -e API_BASE_URL=https://api.example.com atlas-frontend
```

### Static Deployment

Build outputs to `.output/` directory, deployable to any Node.js server or edge runtime.

## Contributing

1. Follow the code organization patterns
2. Add tests for new features
3. Run `npm run quality` before committing
4. Keep components reusable and well-documented
