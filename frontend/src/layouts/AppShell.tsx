import { useCallback, useState, type ReactNode } from 'react'
import {
  LayoutDashboard,
  FolderKanban,
  GitPullRequest,
  Network,
  Rocket,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Sun,
  Moon,
  Monitor,
  LogOut,
  Search,
  FileCode,
  ShieldCheck,
  BookOpen,
  Users,
  LayoutTemplate,
  Shapes,
  KeyRound,
  ListTree,
  MessageSquare,
  GitBranch,
  ArrowLeftRight,
  Archive,
  BadgeCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { useTheme } from '@/lib/theme'
import { Button } from '@/components/ui/button'
import { ChangePasswordDialog } from '@/pages/ChangePasswordDialog'

/**
 * The frame every screen sits inside: a collapsible sidebar, a top bar, and
 * the content area.
 *
 * Navigation items that have no screen yet are marked `soon` and rendered
 * disabled rather than hidden, so the shape of the finished app is visible
 * from the first phase instead of appearing a section at a time.
 *
 * The Project group leads into whichever project is open or, outside any
 * project, the last one opened (App remembers it), and is headed by its name.
 * Only with neither are its items disabled.
 */

interface NavItem {
  id: string
  label: string
  icon: typeof LayoutDashboard
  soon?: boolean
  /** Works with no project open, inside a group that otherwise needs one. */
  anyTime?: boolean
  /** A small icon button at the end of the row, leading somewhere related. */
  extra?: { id: string; label: string; icon: typeof LayoutDashboard }
  /** A heading row over the nested items after it, not a link itself. */
  isLabel?: boolean
  /** Indented under the label row before it. */
  nested?: boolean
}

interface NavGroup {
  /** Empty for the top group, which sits straight under the logo. */
  heading: string
  /** The items only lead somewhere once a project is open. */
  inProject?: boolean
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    heading: '',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'projects', label: 'Projects', icon: FolderKanban },
    ],
  },
  {
    heading: 'Project',
    inProject: true,
    items: [
      { id: 'projectDashboard', label: 'Dashboard', icon: LayoutDashboard },
      // The list everyone edits; Published is the agreed copy of it, and
      // Versions is reached from the Published screen.
      { id: 'inProgress', label: 'Feature List', icon: ListTree },
      {
        id: 'featureList',
        label: 'Published',
        icon: BadgeCheck,
        extra: { id: 'dependencies', label: 'Dependencies', icon: Network },
      },
      { id: 'messages', label: 'Messages', icon: MessageSquare, soon: true },
      { id: 'settingsLabel', label: 'Settings', icon: Settings, isLabel: true, anyTime: true },
      // The team page is not per project yet, so it stays usable from anywhere.
      { id: 'team', label: 'Teams', icon: Users, nested: true, anyTime: true },
    ],
  },
  {
    heading: 'My Area',
    items: [
      { id: 'myDashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'myInProgress', label: 'My Feature List', icon: ListTree },
      { id: 'myVersions', label: 'My Saved Versions', icon: GitBranch },
      { id: 'playground', label: 'Playground', icon: Shapes },
    ],
  },
  {
    heading: 'Tools',
    items: [
      { id: 'templates', label: 'Templates', icon: LayoutTemplate },
      { id: 'imports', label: 'Import / Export', icon: ArrowLeftRight },
      { id: 'backups', label: 'Backup & Restore', icon: Archive },
    ],
  },
  {
    // Screens not in the new layout yet, kept reachable until each is decided.
    heading: 'Misc',
    inProject: true,
    items: [
      { id: 'code', label: 'Linked code', icon: FileCode },
      { id: 'contracts', label: 'Contracts', icon: ShieldCheck },
      { id: 'briefing', label: 'Briefing', icon: BookOpen },
      { id: 'releases', label: 'Releases', icon: Rocket },
      { id: 'prs', label: 'Pull requests', icon: GitPullRequest },
    ],
  },
]

interface AppShellProps {
  active: string
  onNavigate: (id: string) => void
  /** The name of the project the Project group leads into, or null when there is none. */
  projectName: string | null
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
}

export function AppShell({ active, onNavigate, projectName, title, actions, children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false)
  const { user, signOut } = useAuth()

  return (
    <div className="flex h-full bg-bg">
      <aside
        className={cn(
          'flex flex-col border-r border-border bg-surface transition-[width] duration-200',
          collapsed ? 'w-[60px]' : 'w-[256px]',
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
          {NAV.map((group) => {
            const noProject = group.inProject && projectName === null
            const heading = group.heading === 'Project' && projectName ? projectName : group.heading
            return (
              <div key={group.heading}>
                {!collapsed && heading && (
                  <p
                    title={noProject ? 'Open a project to use these' : heading}
                    className="truncate px-2 pb-1.5 text-2xs font-semibold uppercase tracking-wider text-faint"
                  >
                    {heading}
                  </p>
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavButton
                      key={item.id}
                      item={item}
                      active={active === item.id}
                      activeExtra={active === item.extra?.id}
                      disabled={item.soon || (noProject && !item.anyTime)}
                      collapsed={collapsed}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              </div>
            )
          })}
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
  activeExtra,
  disabled,
  collapsed,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  activeExtra: boolean
  disabled?: boolean
  collapsed: boolean
  onNavigate: (id: string) => void
}) {
  const Icon = item.icon
  const extra = item.extra
  const ExtraIcon = extra?.icon

  if (item.isLabel) {
    return (
      <div
        title={collapsed ? item.label : undefined}
        className={cn('flex items-center gap-2.5 px-2 py-1.5 text-sm text-muted', disabled && 'opacity-45')}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => !disabled && onNavigate(item.id)}
        disabled={disabled}
        title={collapsed ? item.label : undefined}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
          active || activeExtra
            ? 'bg-accent-soft font-medium text-accent'
            : 'text-muted hover:bg-raised hover:text-ink',
          disabled && 'cursor-default opacity-45 hover:bg-transparent hover:text-muted',
          extra && !collapsed && 'pr-8',
          item.nested && !collapsed && 'pl-8',
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
      {extra && ExtraIcon && !collapsed && !disabled && (
        <button
          onClick={() => onNavigate(extra.id)}
          title={extra.label}
          aria-label={extra.label}
          aria-current={activeExtra ? 'page' : undefined}
          className={cn(
            'absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded transition-colors',
            activeExtra ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-raised hover:text-ink',
          )}
        >
          <ExtraIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
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
  const [changingPassword, setChangingPassword] = useState(false)
  // Stable, so a re-render of the shell does not re-run the dialog's open
  // effect and pull focus back to its first field mid-typing.
  const closePasswordDialog = useCallback(() => setChangingPassword(false), [])

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
        onClick={() => setChangingPassword(true)}
        title="Change password"
        aria-label="Change password"
      >
        <KeyRound className="h-4 w-4" />
      </Button>
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
      {changingPassword && <ChangePasswordDialog onClose={closePasswordDialog} />}
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
