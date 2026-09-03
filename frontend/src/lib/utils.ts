import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge class names, letting later Tailwind classes win over earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format a count with its noun, pluralised. */
export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

/** Percentage of a total, guarding against division by zero. */
export function percent(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0
}
