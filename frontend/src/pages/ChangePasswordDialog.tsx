import { useEffect, useRef, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { ApiError, post } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * The change-your-own-password dialog, opened from the user menu.
 *
 * It asks for the current password as well as the new one, and for the new one
 * twice, since a typo there would lock the person out at their next sign-in.
 * The repeat is only checked here; the server never sees it.
 *
 * Same keyboard contract as the other dialogs: Escape closes, focus moves in on
 * open and returns to the trigger on close, and a click on the backdrop dismisses.
 */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const currentRef = useRef<HTMLInputElement>(null)
  const previouslyFocused = useRef<Element | null>(null)

  useEffect(() => {
    previouslyFocused.current = document.activeElement
    currentRef.current?.focus()

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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    setFormError('')

    if (next !== repeat) {
      setFieldErrors({ repeat: 'The two new passwords do not match' })
      return
    }

    setSaving(true)
    try {
      await post('/me/password', { current_password: current, new_password: next })
      setDone(true)
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fields)
        if (Object.keys(error.fields).length === 0) setFormError(error.message)
      } else {
        setFormError('Could not reach the server')
      }
    } finally {
      setSaving(false)
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
        aria-labelledby="change-password-title"
        className="flex w-full max-w-sm flex-col animate-fade-in rounded-lg border border-border bg-surface shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="change-password-title" className="text-sm font-semibold text-ink">
            Change password
          </h2>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {done ? (
          <>
            <div className="p-4">
              <p role="status" className="text-sm text-ink">
                Your password has been changed. Use the new one next time you sign in.
              </p>
            </div>
            <div className="flex justify-end border-t border-border p-4">
              <Button onClick={onClose}>Done</Button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div className="space-y-4 p-4">
              {formError && (
                <div
                  role="alert"
                  className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger"
                >
                  {formError}
                </div>
              )}

              <Input
                ref={currentRef}
                type="password"
                label="Current password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                error={fieldErrors.current_password}
                required
              />
              <Input
                type="password"
                label="New password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                error={fieldErrors.new_password}
                hint="At least 8 characters"
                required
              />
              <Input
                type="password"
                label="New password again"
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                error={fieldErrors.repeat}
                required
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-border p-4">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Change password
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
