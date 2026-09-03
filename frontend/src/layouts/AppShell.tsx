import { useState, type ReactNode } from 'react'
import {
  LayoutDashboard,
  FolderKanban,
  ListChecks,
  GitPullRequest,
  Network,
  Tag,
  Rocket,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Sun,
  Moon,
  Monitor,
  LogOut,
  Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { useTheme } from '@/lib/theme'
import { Button } from '@/components/ui/button'

/**
 * The frame every screen sits inside: a collapsible sidebar, a top bar, and
 * the content area.
 *
 * Navigation items that have no screen yet are marked `soon` and rendered
 * disabled rather than hidden, so the shape of the finished app is visible
 * from the first phase instead of appearing a section at a time.
 */

interface NavItem {
  id: string
  label: string
  icon: typeof LayoutDashboard
  soon?: boolean
}

const NAV: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'projects', label: 'Projects', icon: FolderKanban },
    ],
  },
  {
    heading: 'Work',
    items: [
      { id: 'features', label: 'Features', icon: ListChecks, soon: true },
      { id: 'tasks', label: 'Tasks', icon: ListChecks, soon: true },
      { id: 'dependencies', label: 'Dependencies', icon: Network, soon: true },
      { id: 'tags', label: 'Tags', icon: Tag, soon: true },
    ],
  },
  {
    heading: 'Delivery',
    items: [
      { id: 'releases', label: 'Releases', icon: Rocket, soon: true },
      { id: 'prs', label: 'Pull requests', icon: GitPullRequest, soon: true },
    ],
  },
]

interface AppShellProps {
  active: string
  onNavigate: (id: string) => void
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
}

export function AppShell({ active, onNavigate, title, actions, children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false)
  const { user, signOut } = useAuth()

  return (
    <div className="flex h-full bg-bg">
      <aside
        className={cn(
          'flex flex-col border-r border-border bg-surface transition-[width] duration-200',
          collapsed ? 'w-[60px]' : 'w-[228px]',
        )}
      >
        <div className="flex h-14 items-center gap-2.5 px-3 border-b border-border">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-accent-ink text-xs font-bold">
            F+
          </div>
          {!collapsed && (
            <span className="text-sm font-semibold tracking-tight truncate">FeaturePlus</span>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-5">
          {NAV.map((group) => (
            <div key={group.heading}>
              {!collapsed && (
                <p className="px-2 pb-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">
                  {group.heading}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavButton
                    key={item.id}
                    item={item}
                    active={active === item.id}
                    collapsed={collapsed}
                    onClick={() => !item.soon && onNavigate(item.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-2">
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs text-muted hover:bg-raised hover:text-ink transition-colors"
          >
            {collapsed ? (
              <PanelLeft className="h-4 w-4 shrink-0" />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4 shrink-0" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-surface px-5">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-ink">{title}</h1>
          </div>

          <div className="flex items-center gap-2">
            {actions}
            <ThemeToggle />
            <div className="mx-1 h-5 w-px bg-border" />
            <UserMenu name={user?.username ?? ''} role={user?.role ?? ''} onSignOut={signOut} />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] px-5 py-6 animate-fade-in">{children}</div>
        </main>
      </div>
    </div>
  )
}

function NavButton({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: NavItem
  active: boolean
  collapsed: boolean
  onClick: () => void
}) {
  const Icon = item.icon

  return (
    <button
      onClick={onClick}
      disabled={item.soon}
      title={collapsed ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
        active
          ? 'bg-accent-soft font-medium text-accent'
          : 'text-muted hover:bg-raised hover:text-ink',
        item.soon && 'cursor-default opacity-45 hover:bg-transparent hover:text-muted',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="truncate">{item.label}</span>
          {item.soon && (
            <span className="ml-auto text-2xs font-normal text-faint">soon</span>
          )}
        </>
      )}
    </button>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  // A three-way cycle rather than a binary toggle, so "follow the system"
  // stays reachable instead of being lost the first time it is overridden.
  const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 w-8 p-0"
      onClick={() => setTheme(next)}
      title={`Theme: ${theme}. Click for ${next}.`}
      aria-label={`Theme: ${theme}. Switch to ${next}.`}
    >
      <Icon className="h-4 w-4" />
    </Button>
  )
}

function UserMenu({
  name,
  role,
  onSignOut,
}: {
  name: string
  role: string
  onSignOut: () => void
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="hidden text-right sm:block">
        <p className="text-xs font-medium leading-tight text-ink">{name}</p>
        <p className="text-2xs capitalize leading-tight text-faint">{role}</p>
      </div>
      <div className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-2xs font-semibold text-accent">
        {name.slice(0, 2).toUpperCase()}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={onSignOut}
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  )
}

/** A search field for the top bar, used by screens that filter a list. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 w-56 rounded-md border border-border bg-bg pl-8 pr-3 text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
      />
    </div>
  )
}

export { Settings }
