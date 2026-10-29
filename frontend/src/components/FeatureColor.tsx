import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Colours a team marks features with in the working list. The names are what
 * the server stores; the shades are mid-tones that read on both themes.
 */
export const FEATURE_COLORS = [
  { name: 'red', label: 'Red', hex: '#ef4444' },
  { name: 'orange', label: 'Orange', hex: '#f97316' },
  { name: 'yellow', label: 'Yellow', hex: '#eab308' },
  { name: 'green', label: 'Green', hex: '#22c55e' },
  { name: 'teal', label: 'Teal', hex: '#14b8a6' },
  { name: 'blue', label: 'Blue', hex: '#3b82f6' },
  { name: 'purple', label: 'Purple', hex: '#a855f7' },
  { name: 'pink', label: 'Pink', hex: '#ec4899' },
] as const

export function colorHex(name: string | undefined) {
  return FEATURE_COLORS.find((c) => c.name === name)?.hex
}

/**
 * A feature's colour as a circle. With onChange it opens a small palette to
 * pick another or remove it; without, it only shows the colour, if any.
 */
export function ColorDot({
  color,
  title,
  onChange,
  className,
  quiet = false,
}: {
  color: string
  /** The feature's name, for the labels. */
  title: string
  onChange?: (color: string) => void
  className?: string
  /** In a list row: an empty circle shows only while the row is hovered. */
  quiet?: boolean
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const hex = colorHex(color)

  // Closes on a click outside or Escape.
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  const circle = (
    <span
      aria-hidden
      className={cn('block h-2.5 w-2.5 rounded-full', hex ? '' : 'border border-dashed border-faint')}
      style={hex ? { backgroundColor: hex } : undefined}
    />
  )

  if (!onChange) {
    return hex ? (
      <span className={cn('grid h-5 w-5 place-items-center', className)} title={`Colour: ${color}`}>
        {circle}
      </span>
    ) : (
      <span className={cn('h-5 w-5', className)} />
    )
  }

  const pick = (name: string) => {
    setOpen(false)
    if (name !== color) onChange(name)
  }

  return (
    <div ref={box} className={cn('relative', className)} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={hex ? `Colour of ${title}: ${color}. Change it` : `Give ${title} a colour`}
        title={hex ? `Colour: ${color}` : 'Add a colour'}
        className={cn(
          'grid h-5 w-5 place-items-center rounded-full transition hover:bg-border',
          // An empty circle only shows on hover with a mouse, so the column stays quiet.
          quiet &&
            !hex &&
            !open &&
            '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 focus-visible:opacity-100',
        )}
      >
        {circle}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-6 z-30 flex items-center gap-1 rounded-md border border-border bg-surface p-1.5 shadow-card"
        >
          {FEATURE_COLORS.map((c) => (
            <button
              key={c.name}
              type="button"
              role="menuitemradio"
              aria-checked={c.name === color}
              onClick={() => pick(c.name)}
              title={c.label}
              aria-label={c.label}
              className={cn(
                'grid h-6 w-6 place-items-center rounded-full',
                c.name === color && 'ring-2 ring-accent ring-offset-1 ring-offset-surface',
              )}
            >
              <span className="block h-4 w-4 rounded-full" style={{ backgroundColor: c.hex }} />
            </button>
          ))}
          <span className="mx-0.5 h-5 w-px bg-border" />
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!hex}
            onClick={() => pick('')}
            title="No colour"
            aria-label="No colour"
            className="grid h-6 w-6 place-items-center rounded-full text-muted hover:bg-raised hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
