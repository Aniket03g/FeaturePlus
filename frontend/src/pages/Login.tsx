import { useState, type FormEvent } from 'react'
import { Loader2, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/lib/auth'
import { useTheme } from '@/lib/theme'
import { ApiError } from '@/lib/api'

export function Login() {
  const { signIn } = useAuth()
  const { resolved, setTheme } = useTheme()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setFormError('')
    setFieldErrors({})

    try {
      await signIn(email, password)
    } catch (error) {
      if (error instanceof ApiError) {
        // The API separates per-field validation from the overall failure, so
        // a bad email format lands on the field while wrong credentials show
        // above the form.
        setFieldErrors(error.fields)
        if (Object.keys(error.fields).length === 0) setFormError(error.message)
      } else {
        setFormError('Could not reach the server. Is it running?')
      }
      setSubmitting(false)
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-bg px-4">
      {/* A soft wash behind the card, so the page is not a flat rectangle. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[720px] -translate-x-1/2 -translate-y-1/3 rounded-full opacity-[0.13] blur-[110px]"
        style={{ background: 'radial-gradient(circle, hsl(var(--accent)) 0%, transparent 70%)' }}
      />

      <button
        onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
        className="absolute right-5 top-5 grid h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
        aria-label="Toggle theme"
      >
        {resolved === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      <div className="relative w-full max-w-[368px]">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl bg-accent text-base font-bold text-accent-ink shadow-pop">
            F+
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">Welcome back</h1>
          <p className="mt-1 text-sm text-muted">Sign in to continue to FeaturePlus</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-lg border border-border bg-surface p-6 shadow-card"
          noValidate
        >
          {formError && (
            <div
              role="alert"
              className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger"
            >
              {formError}
            </div>
          )}

          <Input
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldErrors.email}
            autoFocus
            required
          />

          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
            required
          />

          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-5 text-center text-2xs text-faint">
          FeaturePlus · feature and task tracking
        </p>
      </div>
    </div>
  )
}

/** Shown while the session check is still in flight on first load. */
export function AuthLoading() {
  return (
    <div className="grid h-full place-items-center bg-bg">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-accent" />
        <p className="text-xs text-muted">Loading…</p>
      </div>
    </div>
  )
}
