import { useEffect, useState } from 'react'
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
import { PublishedList } from '@/pages/PublishedList'
import { ProjectDashboard } from '@/pages/ProjectDashboard'
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
import { CopyEditor, MyVersionsPage, MyWorkingLatest } from '@/pages/MyWorking'
import { MySpaceDashboard } from '@/pages/MySpaceDashboard'
import { MergePage } from '@/pages/MergePage'
import { ComparePage } from '@/pages/ComparePage'

/**
 * Which sidebar item a route belongs to. A feature page still shows the list
 * it was opened from as current rather than nothing at all, and a release
 * detail keeps Releases lit while you are inside one.
 */
const SECTION: Record<Route['name'], string> = {
  dashboard: 'dashboard',
  projects: 'projects',
  project: 'featureList',
  inProgress: 'inProgress',
  feature: 'featureList',
  dependencies: 'dependencies',
  projectDashboard: 'projectDashboard',
  releases: 'releases',
  release: 'releases',
  pullRequests: 'prs',
  code: 'code',
  contracts: 'contracts',
  briefing: 'briefing',
  versions: 'versions',
  merge: 'versions',
  compare: 'versions',
  team: 'team',
  templates: 'templates',
  imports: 'imports',
  playground: 'playground',
  myWorking: 'myInProgress',
  myCopy: 'myInProgress',
  myVersions: 'myVersions',
  mySpace: 'myDashboard',
}

/** The sidebar items that lead into whichever project is currently open. */
const PROJECT_SECTIONS: Record<string, Route['name']> = {
  projectDashboard: 'projectDashboard',
  featureList: 'project',
  inProgress: 'inProgress',
  dependencies: 'dependencies',
  versions: 'versions',
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
  myInProgress: { name: 'myWorking' },
  myVersions: { name: 'myVersions' },
  myDashboard: { name: 'mySpace' },
}

/** Where the last project someone opened is remembered, per person, in this browser. */
const lastProjectKey = (userId: number) => `featureplus:last-project:${userId}`

function readLastProject(userId: number | undefined): number {
  if (!userId) return 0
  try {
    return Number(localStorage.getItem(lastProjectKey(userId))) || 0
  } catch {
    return 0
  }
}

function writeLastProject(userId: number, projectId: number) {
  try {
    if (projectId > 0) localStorage.setItem(lastProjectKey(userId), String(projectId))
    else localStorage.removeItem(lastProjectKey(userId))
  } catch {
    // Storage blocked: the sidebar just forgets, as before.
  }
}

export function App() {
  const { user, isLoading } = useAuth()
  const { route, navigate } = useRouter()
  const [search, setSearch] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [restoringBackup, setRestoringBackup] = useState(false)
  const currentProject = projectOf(route)

  // The sidebar's Project group leads into the project that is open or, on a
  // page outside any project (My Space, the dashboard), the last one opened.
  const [lastProject, setLastProject] = useState(0)
  useEffect(() => setLastProject(readLastProject(user?.id)), [user?.id])
  useEffect(() => {
    if (user && currentProject > 0 && currentProject !== lastProject) {
      writeLastProject(user.id, currentProject)
      setLastProject(currentProject)
    }
  }, [user, currentProject, lastProject])
  const sidebarProject = currentProject > 0 ? currentProject : lastProject
  const project = useProject(sidebarProject)

  // A remembered project that has since gone, or been unshared, is forgotten.
  useEffect(() => {
    if (user && currentProject === 0 && lastProject > 0 && project.isError) {
      writeLastProject(user.id, 0)
      setLastProject(0)
    }
  }, [user, currentProject, lastProject, project.isError])

  if (isLoading) return <AuthLoading />
  if (!user) return <Login />

  // Until the project loads, the group still counts as open, just unnamed.
  const projectName = sidebarProject > 0 && !project.isError ? (project.data?.name ?? '') : null

  function goTo(id: string) {
    setSearch('')

    const topLevel = TOP_LEVEL_SECTIONS[id]
    if (topLevel) return navigate(topLevel)

    // The rest belong to a project: the open one, or the last one opened.
    // With neither, they fall back to the project list.
    const section = PROJECT_SECTIONS[id]
    if (section && projectName !== null) {
      return navigate({ name: section, projectId: sidebarProject } as Route)
    }
    navigate({ name: 'projects' })
  }

  return (
    <AppShell
      active={route.name === 'feature' && route.editable ? 'inProgress' : SECTION[route.name]}
      onNavigate={goTo}
      projectName={projectName}
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
      {route.name === 'projectDashboard' && <ProjectDashboard projectId={route.projectId} />}
      {route.name === 'project' && <PublishedList projectId={route.projectId} />}
      {route.name === 'inProgress' && <ProjectDetail projectId={route.projectId} />}
      {route.name === 'feature' && (
        <FeatureDetail
          projectId={route.projectId}
          featureId={route.featureId}
          editable={route.editable ?? false}
        />
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
      {route.name === 'myWorking' && <MyWorkingLatest />}
      {route.name === 'myVersions' && <MyVersionsPage />}
      {route.name === 'mySpace' && <MySpaceDashboard />}
      {route.name === 'myCopy' && (
        <CopyEditor key={route.copyId} projectId={route.copyProjectId} copyId={route.copyId} />
      )}

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
  projectDashboard: 'Dashboard',
  dependencies: 'Dependencies',
  releases: 'Releases',
  release: 'Releases',
  pullRequests: 'Pull requests',
  code: 'Linked code',
  contracts: 'Contracts',
  briefing: 'Briefing',
  versions: 'Versions',
  inProgress: 'Working list',
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
    case 'myWorking':
    case 'myCopy':
      return (
        <span>
          My Space
          <span className="ml-2 font-normal text-muted">Working</span>
        </span>
      )
    case 'mySpace':
      return (
        <span>
          My Space
          <span className="ml-2 font-normal text-muted">Dashboard</span>
        </span>
      )
    case 'myVersions':
      return (
        <span>
          My Space
          <span className="ml-2 font-normal text-muted">My Versions</span>
        </span>
      )
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
