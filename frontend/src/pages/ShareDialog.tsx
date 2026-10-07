import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRightLeft, LogOut, Users, X } from 'lucide-react'
import { useAddMember, useMembers, useRemoveMember, useTransferProject, useUpdateMember } from '@/lib/queries'
import { useAuth } from '@/lib/auth'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ROLE_LABEL, type ProjectRole } from '@/lib/types'

const SHAREABLE: ProjectRole[] = ['editor', 'viewer']

const ROLE_HINT: Record<ProjectRole, string> = {
  owner: 'Can do everything, including sharing and deleting the project.',
  editor: 'Can change features, tasks, releases and the rest. Cannot share or delete.',
  viewer: 'Can see everything and comment. Cannot change anything.',
  admin: 'Runs this server. Can do everything the owner can.',
}

const selectClass =
  'h-8 rounded-md border border-border bg-surface px-2 text-xs text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40'

/**
 * Who a project is shared with. The owner (or an admin) adds people by the
 * email of their FeaturePlus account, changes their role, removes them, and
 * can hand the project to someone else. Everyone else sees the list and can
 * leave.
 */
export function ShareDialog({
  projectId,
  projectName,
  canManage,
  onClose,
  onLeft,
}: {
  projectId: number
  projectName: string
  canManage: boolean
  onClose: () => void
  onLeft: () => void
}) {
  const { user } = useAuth()
  const members = useMembers(projectId)
  const add = useAddMember(projectId)
  const update = useUpdateMember(projectId)
  const remove = useRemoveMember(projectId)
  const transfer = useTransferProject(projectId)
  const [transferring, setTransferring] = useState(false)
  const [nextOwner, setNextOwner] = useState('')
  const [transferError, setTransferError] = useState('')

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ProjectRole>('editor')
  const [emailError, setEmailError] = useState('')
  const [error, setError] = useState('')

  const emailRef = useRef<HTMLInputElement>(null)
  const previouslyFocused = useRef<Element | null>(null)

  useEffect(() => {
    previouslyFocused.current = document.activeElement
    emailRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      ;(previouslyFocused.current as HTMLElement | null)?.focus?.()
    }
  }, [onClose])

  function failed(err: unknown) {
    if (err instanceof ApiError) {
      if (err.fields.email) setEmailError(err.fields.email)
      else setError(err.message)
    } else {
      setError('Could not reach the server')
    }
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault()
    setEmailError('')
    setError('')
    try {
      await add.mutateAsync({ email: email.trim(), role })
      setEmail('')
    } catch (err) {
      failed(err)
    }
  }

  async function changeRole(userId: number, next: ProjectRole) {
    setError('')
    try {
      await update.mutateAsync({ userId, role: next })
    } catch (err) {
      failed(err)
    }
  }

  async function removeMember(userId: number) {
    setError('')
    try {
      await remove.mutateAsync(userId)
      if (userId === user?.id) onLeft()
    } catch (err) {
      failed(err)
    }
  }

  const list = members.data?.items ?? []
  const amMember = list.some((m) => m.user.id === user?.id && m.role !== 'owner')
  const amOwner = list.some((m) => m.user.id === user?.id && m.role === 'owner')

  async function handleTransfer(event: FormEvent) {
    event.preventDefault()
    setTransferError('')
    try {
      await transfer.mutateAsync(nextOwner.trim())
      setNextOwner('')
      setTransferring(false)
    } catch (err) {
      if (err instanceof ApiError) setTransferError(err.fields.email || err.message)
      else setTransferError('Could not reach the server')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        className="w-full max-w-lg animate-fade-in rounded-lg border border-border bg-surface shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="share-title" className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
            <Users className="h-4 w-4 shrink-0 text-faint" />
            <span className="truncate">Share {projectName}</span>
          </h2>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 p-4">
          {error && (
            <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          {canManage ? (
            <form onSubmit={handleAdd} className="space-y-2" noValidate>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    ref={emailRef}
                    label="Add someone by email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    error={emailError}
                    placeholder="name@example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="share-role" className="block text-xs font-medium text-muted">
                    Role
                  </label>
                  <select
                    id="share-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as ProjectRole)}
                    className={selectClass}
                  >
                    {SHAREABLE.map((option) => (
                      <option key={option} value={option}>
                        {ROLE_LABEL[option]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <span className="block text-xs font-medium text-transparent" aria-hidden>
                    Add
                  </span>
                  <Button type="submit" size="sm" loading={add.isPending} disabled={email.trim() === ''}>
                    Share
                  </Button>
                </div>
              </div>
              <p className="text-2xs text-faint">
                {ROLE_HINT[role]} They need a FeaturePlus account with this email.
              </p>
            </form>
          ) : (
            <p className="text-xs text-muted">Only the project's owner can change who it is shared with.</p>
          )}

          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted">People with access</h3>
            {members.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : members.isError ? (
              <p className="text-xs text-danger">
                {members.error instanceof ApiError ? members.error.message : 'Could not load who has access'}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {list.map((member) => {
                  const isMe = member.user.id === user?.id
                  return (
                    <li key={member.user.id} className="flex items-center gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs text-ink">
                          {member.user.name || member.user.username}
                          {isMe && <span className="text-faint"> (you)</span>}
                        </p>
                        <p className="truncate text-2xs text-faint">{member.user.email}</p>
                      </div>

                      {canManage && member.role !== 'owner' ? (
                        <>
                          <select
                            value={member.role}
                            onChange={(e) => changeRole(member.user.id, e.target.value as ProjectRole)}
                            className={selectClass}
                            aria-label={`Role for ${member.user.name || member.user.username}`}
                          >
                            {SHAREABLE.map((option) => (
                              <option key={option} value={option}>
                                {ROLE_LABEL[option]}
                              </option>
                            ))}
                          </select>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 shrink-0 p-0"
                            onClick={() => removeMember(member.user.id)}
                            aria-label={`Stop sharing with ${member.user.name || member.user.username}`}
                            title="Stop sharing with them"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </>
                      ) : (
                        <Badge tone={member.role === 'owner' ? 'accent' : 'neutral'}>{ROLE_LABEL[member.role]}</Badge>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {list.length === 1 && amOwner && (
              <p className="text-2xs text-faint">Only you can see this project.</p>
            )}
          </div>

          {canManage && (
            <div className="space-y-2 border-t border-border pt-3">
              {!transferring ? (
                <Button variant="ghost" size="sm" onClick={() => setTransferring(true)}>
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  Transfer ownership
                </Button>
              ) : (
                <form onSubmit={handleTransfer} className="space-y-2" noValidate>
                  <Input
                    label="New owner's email"
                    type="email"
                    value={nextOwner}
                    onChange={(e) => setNextOwner(e.target.value)}
                    error={transferError}
                    placeholder="name@example.com"
                  />
                  <p className="text-2xs text-faint">
                    They become the owner. The current owner stays on as an editor, and the new owner can remove them.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => setTransferring(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" loading={transfer.isPending} disabled={nextOwner.trim() === ''}>
                      Transfer
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}

          {amMember && user && (
            <div className="flex justify-end border-t border-border pt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => removeMember(user.id)}
                loading={remove.isPending}
              >
                <LogOut className="h-3.5 w-3.5" />
                Leave project
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
