# Frontend Architecture

[Docs](../README.md) > [Architecture](./README.md) > Frontend Architecture

How the frontend is organized, why we chose TanStack Start, and how to add new features.

## Tech Stack

**Framework:** TanStack Start (React Router 7 + Vite)
**Language:** TypeScript
**Styling:** Tailwind CSS
**State Management:** React Query (server state) + React hooks (UI state)
**Type Safety:** TypeScript types mirror Pydantic schemas from backend

## Why TanStack Start?

**What it is:** Meta-framework built on Vite and React Router. Provides file-based routing, selective SSR, and automatic code splitting.

**Why we chose it:**
1. **File-based routing** — No router configuration file needed. Each `.tsx` file in `src/routes/` is a route. `src/routes/entry/$id.tsx` automatically becomes `/entry/:id`.

2. **Selective SSR** — Most routes are SPAs (rendered in browser). Some routes use SSR (rendered on server, sent to browser). Choose per-route:
   - **SSR routes:** Home, entry detail (better initial load, SEO)
   - **SPA routes:** Search results, admin panel (full interactivity, real-time)

3. **Zero config** — Works out of the box. Vite handles bundling, HMR (hot module replacement), etc.

4. **TypeScript first** — Built with TypeScript. No JavaScript-first confusion.

5. **Small dependency footprint** — No Next.js cruft. Lighter bundle size.

## Directory Structure

```
frontend/src/
├── routes/                    # File-based routes (TanStack Start)
│   ├── __root.tsx            # Root layout (wraps all routes)
│   ├── index.tsx             # Home page (/)
│   ├── search.tsx            # Search page (/search)
│   ├── entry/
│   │   └── $id.tsx           # Entry detail (/entry/:id)
│   └── admin/                # Admin routes (password-protected)
│       ├── __layout.tsx      # Admin layout
│       ├── index.tsx         # Admin dashboard (/admin)
│       └── discovery.tsx     # Run discovery pipeline (/admin/discovery)
│
├── components/               # Reusable React components
│   ├── ui/                   # Low-level UI library
│   │   ├── Button.tsx        # Styled button component
│   │   ├── Card.tsx          # Container/card component
│   │   ├── Input.tsx         # Form input component
│   │   ├── Modal.tsx         # Modal dialog
│   │   └── ...
│   │
│   └── features/             # Feature-level components
│       ├── EntryCard.tsx     # Single entry display
│       ├── EntryList.tsx     # List of entries
│       ├── SearchForm.tsx    # Search input with filters
│       ├── DiscoveryForm.tsx # Location + issues selector
│       └── ...
│
├── hooks/                    # Custom React hooks
│   ├── useEntries.ts         # Fetch entries from /api/v1/entries
│   ├── useSearch.ts          # Search with query string
│   ├── useDiscovery.ts       # Trigger and poll discovery run
│   └── ...
│
├── lib/                      # Utilities and API client
│   ├── api.ts                # Fetch wrapper, error handling
│   ├── utils.ts              # Helper functions (format, validate, etc.)
│   └── constants.ts          # Shared constants
│
├── types/                    # TypeScript type definitions
│   ├── entry.ts              # Entry, EntryResponse types
│   ├── source.ts             # Source type
│   ├── discovery.ts          # DiscoveryRun, discovery request/response
│   └── api.ts                # Error types, pagination
│
├── styles/                   # Global styles
│   └── index.css             # Tailwind imports, global CSS
│
├── router.tsx                # Router configuration
├── entry.client.tsx          # Client entry point
├── entry.server.tsx          # Server entry point
└── vite-env.d.ts             # Vite type definitions
```

## Routing Strategy

### File-Based Routes (TanStack Start Convention)

Each file in `src/routes/` becomes a route:

| File | Route | Type | Behavior |
|---|---|---|---|
| `index.tsx` | `/` | SSR | Home page |
| `search.tsx` | `/search` | SPA | Search interface |
| `entry/$id.tsx` | `/entry/:id` | SSR | Entry detail |
| `admin/index.tsx` | `/admin` | SPA | Admin dashboard |
| `admin/discovery.tsx` | `/admin/discovery` | SPA | Run pipeline |

### SSR vs. SPA Decision

**Use SSR for:**
- Static/mostly-static pages (home, entry detail)
- Pages that benefit from SEO (public directory pages)
- Pages with slow API calls (can fetch on server before sending HTML)

**Use SPA for:**
- Real-time, interactive pages (search, admin)
- Pages with frequent user input
- Pages with complex client-side state

**How to specify:**
```tsx
export const shouldLoad = async () => ({
  ssr: true  // or false
})
```

## Component Organization

### UI Components (Low-Level)

Unstyled or minimally-styled building blocks. No business logic. Reusable across pages.

**Examples:**
- `Button.tsx` — Styled button with size/variant options
- `Card.tsx` — Container with padding and border
- `Input.tsx` — Text input with label and validation feedback
- `Modal.tsx` — Dialog box

**Location:** `src/components/ui/`

**Usage example:**
```tsx
<Button onClick={() => setOpen(true)}>Click me</Button>
```

### Feature Components (High-Level)

Composed from UI components. Contain business logic or API calls. Specific to a feature.

**Examples:**
- `EntryCard.tsx` — Display single entry with actions (favorite, share)
- `EntryList.tsx` — Display list of entries with sorting/filtering
- `SearchForm.tsx` — Search input with issue area filters
- `DiscoveryForm.tsx` — Location + issue areas selector, triggers API call

**Location:** `src/components/features/`

**Usage example:**
```tsx
<SearchForm onSubmit={(query) => performSearch(query)} />
```

## Hooks for API Calls

Custom hooks encapsulate data fetching. Return data, loading state, and errors.

**Pattern:**
```tsx
// src/hooks/useEntries.ts
export function useEntries(state: string, location: string) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      try {
        const response = await api.get('/api/v1/entries', {
          state,
          location
        })
        setData(response)
      } catch (e) {
        setError(e)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [state, location])

  return { data, loading, error }
}
```

**Usage in a component:**
```tsx
function SearchResults({ state, location }) {
  const { data, loading, error } = useEntries(state, location)

  if (loading) return <Spinner />
  if (error) return <ErrorBanner error={error} />
  return <EntryList entries={data} />
}
```

## Type Safety

TypeScript types on frontend **mirror** Pydantic schemas on backend.

**Backend (Python):**
```python
class EntryResponse(BaseModel):
    id: UUID
    name: str
    description: str
    city: str | None = None
    state: str | None = None
    issue_areas: List[str]
    sources: List[SourceResponse]
```

**Frontend (TypeScript):**
```tsx
interface EntryResponse {
  id: string
  name: string
  description: string
  city?: string
  state?: string
  issue_areas: string[]
  sources: SourceResponse[]
}
```

**Why:** When you add a field to the Pydantic schema, TypeScript immediately complains at the call site if you don't handle it. Catches API breakages at compile time.

## API Client

Centralized fetch wrapper in `src/lib/api.ts`.

**Features:**
- Base URL configuration (`http://localhost:8000/api/v1`)
- Error handling (parse error responses, throw typed errors)
- Type safety (response is `T`, errors are `APIError`)
- Automatic serialization/deserialization

**Example:**
```tsx
// GET
const entries = await api.get('/entries', { state: 'KS' })

// POST
const run = await api.post('/discovery', {
  location: 'Kansas City, MO',
  issue_areas: ['labor', 'housing']
})

// Error handling
try {
  const entries = await api.get('/entries')
} catch (error) {
  if (error instanceof APIError) {
    console.error(error.message)
  }
}
```

## Adding a New Page

1. **Create a route file** in `src/routes/`
   ```tsx
   // src/routes/about.tsx
   export default function AboutPage() {
     return <div>About page</div>
   }
   ```

2. **Create components** in `src/components/`
   ```tsx
   // src/components/features/AboutHero.tsx
   export function AboutHero() { ... }
   ```

3. **Use hooks for data** in `src/hooks/` if needed
   ```tsx
   // src/hooks/useStats.ts
   export function useStats() {
     const { data, loading } = useAsync(() => api.get('/stats'))
     return { data, loading }
   }
   ```

4. **Add types** in `src/types/`
   ```tsx
   // src/types/stats.ts
   export interface Stats { ... }
   ```

5. **Link from navigation** in `src/components/features/Nav.tsx` or root layout

## Styling (Tailwind CSS)

All styling uses Tailwind utility classes. No CSS files for component styling.

**Example:**
```tsx
function Card({ title, children }) {
  return (
    <div className="rounded-lg border border-gray-200 p-6 shadow">
      <h2 className="text-xl font-bold">{title}</h2>
      {children}
    </div>
  )
}
```

**Global styles** in `src/styles/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Custom utilities go here */
```

## Current Implementation Status

| Feature | Status | Notes |
|---|---|---|
| Home page | Basic scaffold | Shows static content |
| Search page | Basic scaffold | Form works, API integration pending |
| Entry detail | Basic scaffold | Layout done, data loading pending |
| Admin dashboard | Basic scaffold | Layout done, discovery trigger pending |
| Component library | In progress | Button, Card, Input exist. More needed. |
| Type definitions | Partial | Entry, Source types defined. Need more. |
| Hooks | Partial | useEntries, useSearch stubbed. Need implementation. |

**Next priorities:**
1. Implement useEntries and useSearch hooks (connect to backend)
2. Test API integration
3. Add more UI components (forms, modals, etc.)
4. Implement admin discovery form
5. Add entry favorites/bookmarking

## Development Workflow

### Running Frontend Only
```bash
make dev-frontend
```
Starts Vite dev server on http://localhost:3000 with HMR.

### Type Checking
```bash
cd frontend && pnpm run typecheck
```
Runs TypeScript type checker.

### Linting
```bash
cd frontend && pnpm run lint
```
Runs ESLint.

### Building for Production
```bash
cd frontend && pnpm run build
```
Outputs optimized bundle to `frontend/dist/`.

---

## See Also

- [System Overview](./system-overview.md) — How frontend fits in architecture
- [Frontend Development](../development/frontend.md) — Step-by-step guide to adding features
- [API Reference](./api-reference.md) — REST endpoints and schemas

---

Last updated: March 25, 2026
