import { useState, type FormEvent } from 'react'
import { Check, Copy, KeyRound, Plus, X } from 'lucide-react'
import { useCancelInvite, useCreateInvite, useInvites, type CreatedInvite, type Invite } from '@/lib/queries'
import { ApiError } from '@/lib/api'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const STATUS: Record<Invite['status'], { label: string; tone: 'success' | 'neutral' | 'warning' | 'danger' }> = {
  active: { label: 'Waiting', tone: 'success' },
  used: { label: 'Used', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
}

/**
 * Invite codes, for admins: signing up needs one. A code is shown whole only
 * once, when it is made, to be handed over outside FeaturePlus (in person, by
 * phone, in a chat). Each lets one account be made within 7 days, by the
 * email it was made for if one was given.
 */
export function InviteCodes() {
  const invites = useInvites()
  const create = useCreateInvite()
  const cancel = useCancelInvite()
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [made, setMade] = useState<CreatedInvite | null>(null)
  const [copied, setCopied] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setFieldErrors({})
    try {
      const invite = await create.mutateAsync({ email: email.trim(), note: note.trim() })
      setMade(invite)
      setCopied(false)
      setEmail('')
      setNote('')
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fields)
        if (Object.keys(err.fields).length === 0) setError(err.message)
      } else {
        setError('Could not reach the server')
      }
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const all = invites.data ?? []
  const waiting = all.filter((i) => i.status === 'active')
  const shown = showAll ? all : waiting

  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <KeyRound className="h-4 w-4 text-faint" />
            Invite codes
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            New people need a code to sign up. Make one, then give it to them yourself: in person, by phone or in a
            chat. Each code works once and expires after 7 days.
          </p>
        </div>

        <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
          <Input
            label="Their email (optional)"
            type="email"
            placeholder="Only this address can use it"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldErrors.email}
          />
          <Input
            label="Note (optional)"
            placeholder="e.g. For Rahul, design team"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            error={fieldErrors.note}
          />
          <Button type="submit" className="sm:mt-6" loading={create.isPending}>
            <Plus className="h-3.5 w-3.5" />
            Make a code
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}

        {made && (
          <div className="space-y-2 rounded-md border border-success/40 bg-success-soft/30 px-4 py-3">
            <p className="text-xs text-ink">
              Here is the code{made.email ? ` for ${made.email}` : ''}. Copy it now:{' '}
              <span className="font-medium">it is shown only this once.</span>
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <code className="select-all rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-lg font-semibold tracking-widest text-ink">
                {made.code}
              </code>
              <Button variant="secondary" size="sm" onClick={() => copy(made.code)}>
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMade(null)}>
                Done
              </Button>
            </div>
            <p className="text-2xs text-muted">
              They sign up at <span className="font-mono">{window.location.origin}/app/signup</span> · works until{' '}
              {when(made.expires_at)}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted">
              {showAll ? 'All codes' : `Waiting to be used (${waiting.length})`}
            </p>
            {all.length > waiting.length && (
              <button type="button" className="text-xs text-accent hover:underline" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show only waiting' : `Show all (${all.length})`}
              </button>
            )}
          </div>
          {invites.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : shown.length === 0 ? (
            <p className="text-xs text-faint">No codes waiting to be used.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {shown.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                  <span className="font-mono text-faint" title="The code's last four characters">
                    ····-····-{inv.hint}
                  </span>
                  <Badge tone={STATUS[inv.status].tone}>{STATUS[inv.status].label}</Badge>
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {inv.email || 'Any email'}
                    {inv.note && <span className="text-muted"> · {inv.note}</span>}
                  </span>
                  <span className="text-faint">
                    {inv.status === 'used'
                      ? `used by ${inv.used_by || 'someone'} ${inv.used_at ? when(inv.used_at) : ''}`
                      : inv.status === 'active'
                        ? `until ${when(inv.expires_at)}`
                        : `made ${when(inv.created_at)}`}
                  </span>
                  {inv.status === 'active' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7"
                      loading={cancel.isPending && cancel.variables === inv.id}
                      onClick={() => cancel.mutate(inv.id)}
                      title="Stop this code from working"
                    >
                      <X className="h-3 w-3" />
                      Cancel
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
