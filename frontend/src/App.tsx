import { useState } from 'react'
import { ArchiveRestore, Plus } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { projectOf, useRouter, type Route } from '@/lib/router'
import { useProject } from '@/lib/queries'
import { AppShell, SearchInput } from '@/layouts/AppShell'
import { Button } from '@/components/ui/button'
import { Login, AuthLoading } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { Projects } from '@/pages/Projects'
import { ProjectDetail } from '@/pages/ProjectDetail'
import { FeatureDetail } from '@/pages/FeatureDetail'
import { NewProjectDialog } from '@/pages/NewProjectDialog'
import { RestoreBackupDialog } from '@/pages/RestoreBackupDialog'
import { DependencyCanvas } from '@/pages/DependencyCanvas'
import { Releases } from '@/pages/Releases'
import { ReleaseDetail } from '@/pages/ReleaseDetail'
import { PullRequests } from '@/pages/PullRequests'
import { LinkedCode } from '@/pages/LinkedCode'
import { Contracts } from '@/pages/Contracts'
import { BriefingPage } from '@/pages/BriefingPage'
import { VersionsPage } from '@/pages/VersionsPage'
import { Team } from '@/pages/Team'
import { Templates } from '@/pages/Templates'
import { Imports } from '@/pages/Imports'
import { Playground } from '@/pages/Playground'
import { MergePage } from '@/pages/MergePage'
import { ComparePage } from '@/pages/ComparePage'

/**
 * Which sidebar section a route belongs to. A feature page still shows
 * Projects as current rather than nothing at all, and a release detail keeps
 * Releases lit while you are inside one.
 */
const SECTION: Record<Route['name'], string> = {
  dashboard: 'dashboard',
  projects: 'projects',
  project: 'projects',
  feature: 'projects',
  dependencies: 'dependencies',
  releases: 'releases',
  release: 'releases',
  pullRequests: 'prs',
  code: 'code',
  contracts: 'contracts',
  briefing: 'briefing',
  versions: 'projects',
  merge: 'projects',
  compare: 'projects',
  team: 'team',
  templates: 'templates',
  imports: 'imports',
  playground: 'playground',
}

/** The sidebar items that lead into whichever project is currently open. */
const PROJECT_SECTIONS: Record<string, Route['name']> = {
  dependencies: 'dependencies',
  releases: 'releases',
  prs: 'pullRequests',
  code: 'code',
  contracts: 'contracts',
  briefing: 'briefing',
}

/** The sidebar items that stand on their own. */
const TOP_LEVEL_SECTIONS: Record<string, Route> = {
  dashboard: { name: 'dashboard' },
  projects: { name: 'projects' },
  team: { name: 'team' },
  templates: { name: 'templates' },
  imports: { name: 'imports' },
  playground: { name: 'playground' },
}

export function App() {
  const { user, isLoading } = useAuth()
  const { route, navigate } = useRouter()
  const [search, setSearch] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [restoringBackup, setRestoringBackup] = useState(false)

  if (isLoading) return <AuthLoading />
  if (!user) return <Login />

  const currentProject = projectOf(route)

  function goTo(id: string) {
    setSearch('')

    const topLevel = TOP_LEVEL_SECTIONS[id]
    if (topLevel) return navigate(topLevel)

    // The rest belong to a project, so they only lead somewhere once one is
    // open; otherwise they fall back to the project list.
    const section = PROJECT_SECTIONS[id]
    if (section && currentProject > 0) {
      return navigate({ name: section, projectId: currentProject } as Route)
    }
    navigate({ name: 'projects' })
  }

  return (
    <AppShell
      active={SECTION[route.name]}
      onNavigate={goTo}
      title={<Title />}
      actions={
        route.name === 'projects' ? (
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Search projects…" />
            <Button size="sm" variant="secondary" onClick={() => setRestoringBackup(true)}>
              <ArchiveRestore className="h-3.5 w-3.5" />
              Restore backup
            </Button>
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
      {/* Keyed so switching projects starts fresh, with that project's own sketch. */}
      {route.name === 'dependencies' && (
        <DependencyCanvas key={route.projectId} projectId={route.projectId} />
      )}
      {route.name === 'releases' && <Releases projectId={route.projectId} />}
      {route.name === 'release' && (
        <ReleaseDetail projectId={route.projectId} releaseId={route.releaseId} />
      )}
      {route.name === 'pullRequests' && <PullRequests projectId={route.projectId} />}
      {route.name === 'code' && <LinkedCode projectId={route.projectId} />}
      {route.name === 'contracts' && <Contracts projectId={route.projectId} />}
      {route.name === 'briefing' && <BriefingPage projectId={route.projectId} />}
      {route.name === 'versions' && (
        <VersionsPage key={route.tab ?? 'versions'} projectId={route.projectId} initialTab={route.tab ?? 'versions'} />
      )}
      {route.name === 'merge' && <MergePage projectId={route.projectId} copyId={route.copyId} />}
      {route.name === 'compare' && (
        <ComparePage projectId={route.projectId} from={route.from} to={route.to} />
      )}
      {route.name === 'team' && <Team />}
      {route.name === 'templates' && <Templates />}
      {route.name === 'imports' && <Imports />}
      {route.name === 'playground' && <Playground />}

      {creatingProject && (
        <NewProjectDialog
          onClose={() => setCreatingProject(false)}
          onCreated={(projectId) => {
            setCreatingProject(false)
            navigate({ name: 'project', projectId })
          }}
        />
      )}
      {restoringBackup && (
        <RestoreBackupDialog
          onClose={() => setRestoringBackup(false)}
          onOpenProject={(projectId) => {
            setRestoringBackup(false)
            navigate({ name: 'project', projectId })
          }}
        />
      )}
    </AppShell>
  )
}

/**
 * The heading follows the route. A page inside a project names the project it
 * belongs to, which needs the loaded record, so this is its own component
 * rather than a string computed in App.
 */
const SCOPED_TITLE: Partial<Record<Route['name'], string>> = {
  dependencies: 'Dependencies',
  releases: 'Releases',
  release: 'Releases',
  pullRequests: 'Pull requests',
  code: 'Linked code',
  contracts: 'Contracts',
  briefing: 'Briefing',
  versions: 'Versions',
  merge: 'Merge a copy',
  compare: 'Compare',
}

function Title() {
  const { route } = useRouter()
  const project = useProject(projectOf(route))
  const name = project.data?.name ?? 'Project'

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
    case 'team':
      return <span>Team</span>
    case 'templates':
      return <span>Templates</span>
    case 'imports':
      return <span>Import a project</span>
    case 'playground':
      return <span>Playground</span>
    case 'project':
    case 'feature':
      return <span>{name}</span>
    default:
      return (
        <span>
          {name}
          <span className="ml-2 font-normal text-muted">{SCOPED_TITLE[route.name]}</span>
        </span>
      )
  }
}
