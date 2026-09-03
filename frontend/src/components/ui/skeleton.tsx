import { cn } from '@/lib/utils'

/**
 * A loading placeholder shaped like the content it stands in for, so the
 * layout does not jump when data arrives.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-md bg-raised', className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-border/60 to-transparent" />
    </div>
  )
}
