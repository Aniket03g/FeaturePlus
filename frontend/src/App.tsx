import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useRouter } from '@/lib/router'
import { useProject } from '@/lib/queries'
import { AppShell, SearchInput } from '@/layouts/AppShell'
import { Button } from '@/components/ui/button'
import { Login, AuthLoading } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { Projects } from '@/pages/Projects'
import { ProjectDetail } from '@/pages/ProjectDetail'
import { FeatureDetail } from '@/pages/FeatureDetail'
import { NewProjectDialog } from '@/pages/NewProjectDialog'
import { DependencyCanvas } from '@/pages/DependencyCanvas'

export function App() {
  const { user, isLoading } = useAuth()
  const { route, navigate } = useRouter()
  const [search, setSearch] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)

  if (isLoading) return <AuthLoading />
  if (!user) return <Login />

  // The sidebar highlights the section a route belongs to, so a feature page
  // still shows Projects as current rather than nothing at all.
  const section =
    route.name === 'dashboard'
      ? 'dashboard'
      : route.name === 'dependencies'
        ? 'dependencies'
        : 'projects'

  return (
    <AppShell
      active={section}
      onNavigate={(id) => {
        setSearch('')
        if (id === 'dashboard') return navigate({ name: 'dashboard' })
        // Dependencies belong to a project, so the item only leads somewhere
        // once one is open; otherwise it falls back to the project list.
        if (id === 'dependencies') {
          const projectId =
            route.name === 'project' || route.name === 'feature' || route.name === 'dependencies'
              ? route.projectId
              : 0
          return navigate(projectId > 0 ? { name: 'dependencies', projectId } : { name: 'projects' })
        }
        navigate({ name: 'projects' })
      }}
      title={<Title />}
      actions={
        route.name === 'projects' ? (
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Search projects…" />
            <Button size="sm" onClick={() => setCreatingProject(true)}>
              <Plus className="h-3.5 w-3.5" />
              New project
            </Button>
          </>
        ) : null
      }
    >
      {route.name === 'dashboard' && (
        <Dashboard onOpenProject={(projectId) => navigate({ name: 'project', projectId })} />
      )}
      {route.name === 'projects' && (
        <Projects
          search={search}
          onOpenProject={(projectId) => navigate({ name: 'project', projectId })}
        />
      )}
      {route.name === 'project' && <ProjectDetail projectId={route.projectId} />}
      {route.name === 'feature' && (
        <FeatureDetail projectId={route.projectId} featureId={route.featureId} />
      )}
      {route.name === 'dependencies' && <DependencyCanvas projectId={route.projectId} />}

      {creatingProject && (
        <NewProjectDialog
          onClose={() => setCreatingProject(false)}
          onCreated={(projectId) => {
            setCreatingProject(false)
            navigate({ name: 'project', projectId })
          }}
        />
      )}
    </AppShell>
  )
}

/**
 * The heading follows the route. A project or feature page names the project
 * it belongs to, which needs the loaded record, so this is its own component
 * rather than a string computed in App.
 */
function Title() {
  const { route } = useRouter()
  const projectId =
    route.name === 'project' || route.name === 'feature' || route.name === 'dependencies'
      ? route.projectId
      : 0
  const project = useProject(projectId)

  switch (route.name) {
    case 'dashboard':
      return (
        <span>
          Dashboard
          <span className="ml-2 font-normal text-muted">Everything across your projects</span>
        </span>
      )
    case 'projects':
      return <span>Projects</span>
    case 'project':
      return <span>{project.data?.name ?? 'Project'}</span>
    case 'feature':
      return <span>{project.data?.name ?? 'Feature'}</span>
    case 'dependencies':
      return (
        <span>
          {project.data?.name ?? 'Project'}
          <span className="ml-2 font-normal text-muted">Dependencies</span>
        </span>
      )
  }
}
