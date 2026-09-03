import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * Routing.
 *
 * The app is served from /app, so a route is whatever follows that prefix.
 * This is a small hand-rolled router over the History API rather than a
 * library, because the whole route table is four patterns and the screens
 * need exactly two things from it: a URL that survives a reload, and a back
 * button that works.
 *
 * Route shapes:
 *   /app/                       dashboard
 *   /app/projects               project list
 *   /app/projects/:id           project detail, feature list
 *   /app/projects/:id/features/:featureId   feature detail
 *   /app/projects/:id/dependencies          dependency canvas
 */

const BASE = '/app'

export type Route =
  | { name: 'dashboard' }
  | { name: 'projects' }
  | { name: 'project'; projectId: number }
  | { name: 'feature'; projectId: number; featureId: number }
  | { name: 'dependencies'; projectId: number }

/** Parse a pathname into a route, falling back to the dashboard. */
export function parseRoute(pathname: string): Route {
  const path = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname
  const parts = path.split('/').filter(Boolean)

  if (parts.length === 0) return { name: 'dashboard' }
  if (parts[0] !== 'projects') return { name: 'dashboard' }
  if (parts.length === 1) return { name: 'projects' }

  const projectId = Number(parts[1])
  if (!Number.isFinite(projectId) || projectId <= 0) return { name: 'projects' }

  if (parts[2] === 'dependencies') {
    return { name: 'dependencies', projectId }
  }

  if (parts[2] === 'features' && parts[3]) {
    const featureId = Number(parts[3])
    if (Number.isFinite(featureId) && featureId > 0) {
      return { name: 'feature', projectId, featureId }
    }
  }

  return { name: 'project', projectId }
}

/** Build the pathname for a route. */
export function routeToPath(route: Route): string {
  switch (route.name) {
    case 'dashboard':
      return `${BASE}/`
    case 'projects':
      return `${BASE}/projects`
    case 'project':
      return `${BASE}/projects/${route.projectId}`
    case 'feature':
      return `${BASE}/projects/${route.projectId}/features/${route.featureId}`
    case 'dependencies':
      return `${BASE}/projects/${route.projectId}/dependencies`
  }
}

interface RouterValue {
  route: Route
  navigate: (route: Route) => void
  back: () => void
}

const RouterContext = createContext<RouterValue | null>(null)

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname))

  // The back and forward buttons change the URL without us; follow them.
  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((next: Route) => {
    const path = routeToPath(next)
    if (path !== window.location.pathname) {
      window.history.pushState({}, '', path)
    }
    setRoute(next)
    // A new screen starts at the top, as a page load would.
    window.scrollTo(0, 0)
  }, [])

  const back = useCallback(() => window.history.back(), [])

  return (
    <RouterContext.Provider value={{ route, navigate, back }}>{children}</RouterContext.Provider>
  )
}

export function useRouter() {
  const value = useContext(RouterContext)
  if (!value) throw new Error('useRouter must be used inside RouterProvider')
  return value
}
