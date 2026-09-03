import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import { AppShell, SearchInput } from '@/layouts/AppShell'
import { Login, AuthLoading } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { Projects } from '@/pages/Projects'

/**
 * Screen selection is local state for now. Phase 3 introduces TanStack Router,
 * at which point this becomes a route tree; keeping it simple until then means
 * the routing decisions are made once, against real screens, rather than
 * guessed at now.
 */
export function App() {
  const { user, isLoading } = useAuth()
  const [screen, setScreen] = useState('dashboard')
  const [search, setSearch] = useState('')

  if (isLoading) return <AuthLoading />
  if (!user) return <Login />

  const titles: Record<string, { title: string; subtitle?: string }> = {
    dashboard: { title: 'Dashboard', subtitle: 'Everything across your projects' },
    projects: { title: 'Projects' },
  }
  const heading = titles[screen] ?? { title: screen }

  return (
    <AppShell
      active={screen}
      onNavigate={(id) => {
        setScreen(id)
        setSearch('')
      }}
      title={heading.title}
      subtitle={heading.subtitle}
      actions={
        screen === 'projects' ? (
          <SearchInput value={search} onChange={setSearch} placeholder="Search projects…" />
        ) : null
      }
    >
      {screen === 'dashboard' && <Dashboard onOpenProject={() => setScreen('projects')} />}
      {screen === 'projects' && <Projects search={search} />}
    </AppShell>
  )
}
