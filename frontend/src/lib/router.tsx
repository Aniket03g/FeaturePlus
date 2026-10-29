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
 *   /app/projects/:id           the published feature list: the latest publish, read-only
 *   /app/projects/:id/features/:featureId    feature detail, read-only
 *   /app/projects/:id/working            the working list: the same features, editable
 *   /app/projects/:id/working/features/:featureId    feature detail, editable
 *   /app/projects/:id/dashboard              where the project stands, what has changed
 *   /app/projects/:id/dependencies           dependency canvas
 *   /app/projects/:id/releases               release list
 *   /app/projects/:id/releases/:releaseId    release detail
 *   /app/projects/:id/pull-requests          pull request queue
 *   /app/projects/:id/code                   the file and commit map
 *   /app/projects/:id/contracts              contracts, with a viewer
 *   /app/projects/:id/briefing               the collaborator briefing
 *   /app/projects/:id/versions               saved versions of the feature list
 *   /app/projects/:id/versions/copies        the same page, on its Copies tab
 *   /app/projects/:id/copies/:copyId/merge   merging a published copy into the list
 *   /app/projects/:id/compare/:from/:to      two lists compared as a tree (a version id, c+copy id, or current)
 *   /app/team                                people and roles
 *   /app/templates                           the template catalogue
 *   /app/imports                             saved analyses and GitHub import
 *   /app/playground                          draft a feature list, then import it
 *   /app/my/working                          My Space: the copy you edited last, open for editing
 *   /app/my/working/:projectId/:copyId       one particular copy, open for editing
 *   /app/my/versions                         My Space: all your copies
 *   /app/my                                  My Space: dashboard
 */

const BASE = '/app'

export type Route =
  | { name: 'dashboard' }
  | { name: 'projects' }
  | { name: 'project'; projectId: number }
  | { name: 'inProgress'; projectId: number }
  /** `editable` when opened from the Working list; otherwise read-only. */
  | { name: 'feature'; projectId: number; featureId: number; editable?: boolean }
  | { name: 'dependencies'; projectId: number }
  | { name: 'projectDashboard'; projectId: number }
  | { name: 'releases'; projectId: number }
  | { name: 'release'; projectId: number; releaseId: number }
  | { name: 'pullRequests'; projectId: number }
  | { name: 'code'; projectId: number }
  | { name: 'contracts'; projectId: number }
  | { name: 'briefing'; projectId: number }
  | { name: 'versions'; projectId: number; tab?: 'copies' }
  | { name: 'merge'; projectId: number; copyId: number }
  | { name: 'compare'; projectId: number; from: string; to: string }
  | { name: 'team' }
  | { name: 'templates' }
  | { name: 'imports' }
  | { name: 'playground' }
  | { name: 'myWorking' }
  | { name: 'myVersions' }
  | { name: 'mySpace' }
  // Not `projectId`: a copy is yours, not the project's, so the sidebar's
  // Project group should not light up for it.
  | { name: 'myCopy'; copyProjectId: number; copyId: number }

/** The routes that are not scoped to a project, keyed by their first segment. */
const TOP_LEVEL: Record<string, Route> = {
  team: { name: 'team' },
  templates: { name: 'templates' },
  imports: { name: 'imports' },
  playground: { name: 'playground' },
}

/** The project sub-pages that take no further segments. */
const PROJECT_SECTIONS: Record<string, Route['name']> = {
  dashboard: 'projectDashboard',
  dependencies: 'dependencies',
  'pull-requests': 'pullRequests',
  code: 'code',
  contracts: 'contracts',
  briefing: 'briefing',
  versions: 'versions',
}

/** Parse a pathname into a route, falling back to the dashboard. */
export function parseRoute(pathname: string): Route {
  const path = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname
  const parts = path.split('/').filter(Boolean)

  if (parts.length === 0) return { name: 'dashboard' }

  const topLevel = TOP_LEVEL[parts[0]]
  if (topLevel) return topLevel

  if (parts[0] === 'my' && parts[1] === 'versions') return { name: 'myVersions' }
  if (parts[0] === 'my' && !parts[1]) return { name: 'mySpace' }
  if (parts[0] === 'my' && parts[1] === 'working') {
    const copyProjectId = Number(parts[2])
    const copyId = Number(parts[3])
    if (copyProjectId > 0 && copyId > 0) return { name: 'myCopy', copyProjectId, copyId }
    return { name: 'myWorking' }
  }

  if (parts[0] !== 'projects') return { name: 'dashboard' }
  if (parts.length === 1) return { name: 'projects' }

  const projectId = Number(parts[1])
  if (!Number.isFinite(projectId) || projectId <= 0) return { name: 'projects' }

  if (parts[2] === 'versions' && parts[3] === 'copies') return { name: 'versions', projectId, tab: 'copies' }

  if (parts[2] === 'compare' && parts[3] && parts[4]) return { name: 'compare', projectId, from: parts[3], to: parts[4] }

  if (parts[2] === 'copies' && parts[4] === 'merge') {
    const copyId = Number(parts[3])
    if (Number.isFinite(copyId) && copyId > 0) return { name: 'merge', projectId, copyId }
  }

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

  if (parts[2] === 'working') {
    const featureId = Number(parts[4])
    if (parts[3] === 'features' && Number.isFinite(featureId) && featureId > 0) {
      return { name: 'feature', projectId, featureId, editable: true }
    }
    return { name: 'inProgress', projectId }
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
    case 'inProgress':
      return `${BASE}/projects/${route.projectId}/working`
    case 'myWorking':
      return `${BASE}/my/working`
    case 'myVersions':
      return `${BASE}/my/versions`
    case 'mySpace':
      return `${BASE}/my`
    case 'myCopy':
      return `${BASE}/my/working/${route.copyProjectId}/${route.copyId}`
    case 'feature':
      return route.editable
        ? `${BASE}/projects/${route.projectId}/working/features/${route.featureId}`
        : `${BASE}/projects/${route.projectId}/features/${route.featureId}`
    case 'dependencies':
      return `${BASE}/projects/${route.projectId}/dependencies`
    case 'projectDashboard':
      return `${BASE}/projects/${route.projectId}/dashboard`
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
    case 'versions':
      return `${BASE}/projects/${route.projectId}/versions${route.tab === 'copies' ? '/copies' : ''}`
    case 'compare':
      return `${BASE}/projects/${route.projectId}/compare/${route.from}/${route.to}`
    case 'merge':
      return `${BASE}/projects/${route.projectId}/copies/${route.copyId}/merge`
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
