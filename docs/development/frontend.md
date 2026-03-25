# Frontend Development

[Docs](../README.md) > [Development](./README.md) > Frontend Development

How to build features on the React/TanStack Start frontend. Adding routes, components, and hooks.

## Prerequisites

- Node.js 20+ installed
- Frontend dependencies installed (`make setup` or `cd frontend && npm install`)
- Familiar with React and TypeScript

## Adding a New Route/Page

### 1. Create the Route File

Routes use file-based convention in `frontend/src/routes/`:

```tsx
// frontend/src/routes/my-page.tsx
import { useEffect, useState } from 'react'

export default function MyPageComponent() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch data, set state, etc.
  }, [])

  return (
    <div>
      <h1>My Page</h1>
      {loading && <p>Loading...</p>}
      {data && <p>{data}</p>}
    </div>
  )
}
```

The file `frontend/src/routes/my-page.tsx` automatically becomes route `/my-page`.

### 2. Nested Routes

Use folder structure to create nested routes:

```tsx
// frontend/src/routes/entries/$id.tsx
// This becomes /entries/:id

import { useParams } from '@tanstack/react-router'

export default function EntryDetailPage() {
  const { id } = useParams({ from: '/entries/$id' })

  return <div>Entry {id}</div>
}
```

### 3. Dynamic Segments

Folder name with `$` prefix becomes a dynamic segment:

```
routes/
├── entries/
│   ├── index.tsx      → /entries
│   └── $id.tsx        → /entries/:id
├── search.tsx         → /search
└── index.tsx          → /
```

### 4. Add Styling

Use Tailwind utility classes:

```tsx
export default function MyPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="bg-blue-600 text-white py-4">
        <h1 className="text-3xl font-bold px-4">My Page</h1>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <p className="text-gray-700">Content here</p>
      </main>
    </div>
  )
}
```

### 5. Link to the Page

In `frontend/src/components/features/Nav.tsx` or root layout:

```tsx
import { Link } from '@tanstack/react-router'

export function Navigation() {
  return (
    <nav>
      <Link to="/">Home</Link>
      <Link to="/my-page">My Page</Link>
      <Link to="/entries">Entries</Link>
    </nav>
  )
}
```

### 6. Test the Route

```bash
cd frontend && npm run dev
```

Navigate to `http://localhost:3000/my-page`

---

## Adding a New Component

### 1. Create the Component

Components go in `frontend/src/components/`:

**UI Component (reusable, no business logic):**

```tsx
// frontend/src/components/ui/Badge.tsx
interface BadgeProps {
  label: string
  color?: 'blue' | 'green' | 'red' | 'gray'
}

export function Badge({ label, color = 'gray' }: BadgeProps) {
  const colorClass = {
    blue: 'bg-blue-100 text-blue-800',
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-800',
    gray: 'bg-gray-100 text-gray-800'
  }[color]

  return (
    <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${colorClass}`}>
      {label}
    </span>
  )
}
```

**Feature Component (domain-specific):**

```tsx
// frontend/src/components/features/EntryCard.tsx
import { Badge } from '../ui/Badge'
import { Entry } from '../../types/entry'

interface EntryCardProps {
  entry: Entry
  onClick?: (entry: Entry) => void
}

export function EntryCard({ entry, onClick }: EntryCardProps) {
  return (
    <div
      className="border border-gray-200 rounded-lg p-6 hover:shadow-lg cursor-pointer transition-shadow"
      onClick={() => onClick?.(entry)}
    >
      <h3 className="text-lg font-bold mb-2">{entry.name}</h3>

      <p className="text-gray-600 text-sm mb-4">{entry.description}</p>

      <div className="flex flex-wrap gap-2 mb-3">
        {entry.issue_areas.map(area => (
          <Badge key={area} label={area} color="blue" />
        ))}
      </div>

      <p className="text-xs text-gray-500">
        {entry.city}, {entry.state}
      </p>
    </div>
  )
}
```

### 2. Use the Component

```tsx
// In a page or another component
import { EntryCard } from '../components/features/EntryCard'

export function MyPage() {
  const entries = [
    { id: '1', name: 'Org 1', ... },
    { id: '2', name: 'Org 2', ... }
  ]

  return (
    <div className="grid grid-cols-3 gap-4">
      {entries.map(entry => (
        <EntryCard key={entry.id} entry={entry} />
      ))}
    </div>
  )
}
```

### 3. Export from Index

Optionally create `frontend/src/components/index.ts` for easy importing:

```tsx
// frontend/src/components/index.ts
export { Badge } from './ui/Badge'
export { Button } from './ui/Button'
export { EntryCard } from './features/EntryCard'
```

Then use:
```tsx
import { EntryCard, Badge } from '../components'
```

---

## Adding a Custom Hook

Hooks encapsulate data fetching and state logic.

### 1. Create the Hook

```tsx
// frontend/src/hooks/useEntries.ts
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Entry } from '../types/entry'

interface UseEntriesOptions {
  state?: string
  issue_area?: string
}

interface UseEntriesResult {
  entries: Entry[] | null
  loading: boolean
  error: Error | null
}

export function useEntries(options?: UseEntriesOptions): UseEntriesResult {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const fetchEntries = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await api.get('/entries', options)
        setEntries(response.data)
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'))
      } finally {
        setLoading(false)
      }
    }

    fetchEntries()
  }, [options?.state, options?.issue_area])

  return { entries, loading, error }
}
```

### 2. Use the Hook

```tsx
import { useEntries } from '../hooks/useEntries'
import { EntryCard } from '../components/features/EntryCard'

export default function SearchPage() {
  const { entries, loading, error } = useEntries({
    state: 'KS'
  })

  if (loading) return <div>Loading...</div>
  if (error) return <div>Error: {error.message}</div>

  return (
    <div className="grid gap-4">
      {entries?.map(entry => (
        <EntryCard key={entry.id} entry={entry} />
      ))}
    </div>
  )
}
```

---

## Adding a New Type Definition

TypeScript types mirror Pydantic schemas from the backend.

### 1. Create Type File

```tsx
// frontend/src/types/entry.ts
export interface Entry {
  id: string
  type: 'person' | 'organization' | 'initiative' | 'campaign' | 'event'
  name: string
  description: string
  city?: string
  state?: string
  website?: string
  issue_areas: string[]
  sources: Source[]
  active: boolean
  created_at: string
  updated_at: string
}

export interface Source {
  id: string
  url: string
  title?: string
  publication?: string
  published_date?: string
}

export interface EntryResponse {
  data: Entry
}

export interface EntriesResponse {
  data: Entry[]
  pagination?: {
    page: number
    page_size: number
    total: number
    has_more: boolean
  }
}
```

### 2. Use in Components and Hooks

```tsx
import { Entry, EntriesResponse } from '../types/entry'

// In a hook
export function useEntries(): UseEntriesResult<Entry> { ... }

// In a component
interface EntryCardProps {
  entry: Entry
}
```

---

## Form Handling

### Basic Form

```tsx
import { useState } from 'react'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export function SearchForm() {
  const [query, setQuery] = useState('')
  const [state, setState] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Call API or parent handler
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search entries..."
      />

      <Input
        label="State"
        value={state}
        onChange={(e) => setState(e.target.value)}
        placeholder="KS"
      />

      <Button type="submit">Search</Button>
    </form>
  )
}
```

### Form with Validation

```tsx
interface FormData {
  name: string
  email: string
}

interface FormErrors {
  name?: string
  email?: string
}

export function SignupForm() {
  const [data, setData] = useState<FormData>({ name: '', email: '' })
  const [errors, setErrors] = useState<FormErrors>({})

  const validate = (): boolean => {
    const newErrors: FormErrors = {}

    if (!data.name) {
      newErrors.name = 'Name is required'
    }

    if (!data.email.includes('@')) {
      newErrors.email = 'Invalid email'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validate()) return

    // Submit form
  }

  return (
    <form onSubmit={handleSubmit}>
      <Input
        label="Name"
        value={data.name}
        onChange={(e) => setData({ ...data, name: e.target.value })}
        error={errors.name}
      />

      <Input
        label="Email"
        value={data.email}
        onChange={(e) => setData({ ...data, email: e.target.value })}
        error={errors.email}
      />

      <Button type="submit">Sign Up</Button>
    </form>
  )
}
```

---

## Client vs. Server Components

TanStack Start supports selective SSR. By default, routes are SPAs (rendered in browser).

### Mark a Route as SSR

```tsx
// frontend/src/routes/index.tsx (home page)

// Option 1: Export metadata
export const route = {
  ssr: true  // Render on server
}

export default function HomePage() {
  // This runs on server, HTML is sent to browser
  // Good for: static pages, SEO
  return <div>Home Page</div>
}
```

### Mark a Route as SPA

```tsx
// frontend/src/routes/admin/discovery.tsx (admin page)

export const route = {
  ssr: false  // Render in browser only
}

export default function AdminDiscoveryPage() {
  // This runs in browser only
  // Good for: interactive forms, real-time data
  return <div>Admin Discovery</div>
}
```

---

## Running Linting and Type Checks

```bash
cd frontend

# Type check
npm run typecheck

# Lint
npm run lint

# Format check
npm run format:check

# Auto-fix
npm run lint:fix
npm run format
```

All must pass before committing.

---

## Testing (When Configured)

Frontend testing is not yet configured. Once set up:

```bash
cd frontend

# Run tests
npm run test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

---

## Common Patterns

### Data Fetching Pattern

```tsx
export function MyComponent() {
  const { data, loading, error } = useMyData()

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorBanner error={error} />
  if (!data) return <EmptyState />

  return <Content data={data} />
}
```

### Conditional Rendering

```tsx
{/* Don't use ternary if either branch is null */}
{isLoading && <Spinner />}
{isLoaded && <Content />}
{isError && <Error />}

{/* Use logical AND for simple cases */}
{hasData && <Content />}

{/* Use switch for complex logic */}
{status === 'loading' && <Spinner />}
{status === 'loaded' && <Content />}
{status === 'error' && <Error />}
```

### Event Handlers

```tsx
const handleClick = () => {
  // Do something
}

const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault()
  // Do something
}

const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  setQuery(e.target.value)
}

return (
  <form onSubmit={handleSubmit}>
    <input onChange={handleChange} />
    <button onClick={handleClick}>Submit</button>
  </form>
)
```

---

## See Also

- [Frontend Architecture](../architecture/frontend.md) — How TanStack Start works
- [API Reference](../architecture/api-reference.md) — Backend endpoints
- [Code Quality](./code-quality.md) — Fix lint/type errors

---

Last updated: March 25, 2026
