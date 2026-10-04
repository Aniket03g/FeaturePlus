import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * Routing.
 *
 * The app is served from /app, so a route is whatever follows that prefix.
 * This is a small hand-rolled router over the History API rather than a
 * library, because the screens need exactly two things from it: a URL that
 * survives a reload, and a back button that works.
 *
 * Route shapes:
 *   /app/                       dashboard
 *   /app/projects               project list
 *   /app/projects/:id           project detail, feature list
 *   /app/projects/:id/features/:featureId    feature detail
 *   /app/projects/:id/dependencies           dependency canvas
 *   /app/projects/:id/releases               release list
 *   /app/projects/:id/releases/:releaseId    release detail
 *   /app/projects/:id/pull-requests          pull request queue
 *   /app/projects/:id/code                   the file and commit map
 *   /app/projects/:id/contracts              contracts, with a viewer
 *   /app/projects/:id/briefing               the collaborator briefing
 *   /app/team                                people and roles
 *   /app/templates                           the template catalogue
 *   /app/imports                             saved analyses and GitHub import
 *   /app/playground                          draft a feature list, then import it
 */

const BASE = '/app'

export type Route =
  | { name: 'dashboard' }
  | { name: 'projects' }
  | { name: 'project'; projectId: number }
  | { name: 'feature'; projectId: number; featureId: number }
  | { name: 'dependencies'; projectId: number }
  | { name: 'releases'; projectId: number }
  | { name: 'release'; projectId: number; releaseId: number }
  | { name: 'pullRequests'; projectId: number }
  | { name: 'code'; projectId: number }
  | { name: 'contracts'; projectId: number }
  | { name: 'briefing'; projectId: number }
  | { name: 'team' }
  | { name: 'templates' }
  | { name: 'imports' }
  | { name: 'playground' }

/** The routes that are not scoped to a project, keyed by their first segment. */
const TOP_LEVEL: Record<string, Route> = {
  team: { name: 'team' },
  templates: { name: 'templates' },
  imports: { name: 'imports' },
  playground: { name: 'playground' },
}

/** The project sub-pages that take no further segments. */
const PROJECT_SECTIONS: Record<string, Route['name']> = {
  dependencies: 'dependencies',
  'pull-requests': 'pullRequests',
  code: 'code',
  contracts: 'contracts',
  briefing: 'briefing',
}

/** Parse a pathname into a route, falling back to the dashboard. */
export function parseRoute(pathname: string): Route {
  const path = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname
  const parts = path.split('/').filter(Boolean)

  if (parts.length === 0) return { name: 'dashboard' }

  const topLevel = TOP_LEVEL[parts[0]]
  if (topLevel) return topLevel

  if (parts[0] !== 'projects') return { name: 'dashboard' }
  if (parts.length === 1) return { name: 'projects' }

  const projectId = Number(parts[1])
  if (!Number.isFinite(projectId) || projectId <= 0) return { name: 'projects' }

  const section = PROJECT_SECTIONS[parts[2]]
  if (section) {
    return { name: section, projectId } as Route
  }

  if (parts[2] === 'releases') {
    if (!parts[3]) return { name: 'releases', projectId }

    const releaseId = Number(parts[3])
    if (Number.isFinite(releaseId) && releaseId > 0) {
      return { name: 'release', projectId, releaseId }
    }
    return { name: 'releases', projectId }
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
    case 'releases':
      return `${BASE}/projects/${route.projectId}/releases`
    case 'release':
      return `${BASE}/projects/${route.projectId}/releases/${route.releaseId}`
    case 'pullRequests':
      return `${BASE}/projects/${route.projectId}/pull-requests`
    case 'code':
      return `${BASE}/projects/${route.projectId}/code`
    case 'contracts':
      return `${BASE}/projects/${route.projectId}/contracts`
    case 'briefing':
      return `${BASE}/projects/${route.projectId}/briefing`
    case 'team':
      return `${BASE}/team`
    case 'templates':
      return `${BASE}/templates`
    case 'imports':
      return `${BASE}/imports`
    case 'playground':
      return `${BASE}/playground`
  }
}

/**
 * The project a route belongs to, or 0 for the routes that belong to none.
 *
 * Several screens ask this — the title, the sidebar, anything scoped to a
 * project — and each one keeping its own list of cases is how a new route ends
 * up half-wired.
 */
export function projectOf(route: Route): number {
  return 'projectId' in route ? route.projectId : 0
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
