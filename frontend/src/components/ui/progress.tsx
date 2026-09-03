import { cn } from '@/lib/utils'
import { percent } from '@/lib/utils'

interface ProgressProps {
  value: number
  total: number
  className?: string
  tone?: 'accent' | 'success'
  label?: string
}

/** A thin completion bar. It reports its value to assistive tech as a meter. */
export function Progress({ value, total, className, tone = 'accent', label }: ProgressProps) {
  const pct = percent(value, total)

  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-raised', className)}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500 ease-out',
          tone === 'success' ? 'bg-success' : 'bg-accent',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
