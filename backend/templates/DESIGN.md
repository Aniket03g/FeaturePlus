# FeaturePlus UI Design System

The single source of truth for styling every template. **Read this before regenerating
any template** (in Claude Fable, Claude Code, or by hand). The goal is that a fragment
restyled in isolation still looks identical to the same component elsewhere.

---

## Stack (do not change)

- **Go `html/template`** — server-rendered. Preserve every `{{ . }}`, `{{ range }}`,
  `{{ if }}`, `{{ block }}`, `{{ template }}` directive and every
  `id="...-{{ .Task.ID }}"` pattern exactly.
- **HTMX 1.9.10** — keep all `hx-*` attributes byte-for-byte: `hx-get/post`,
  `hx-target`, `hx-swap` (the `outerHTML`/`innerHTML` contract), `hx-trigger`,
  `hx-vals`, `hx-push-url`, `hx-headers`.
- **Alpine.js 3.x** — keep all `x-data`, `x-show`, `x-transition`, `@click`, `:class`.
- **Tailwind via CDN** — utility classes only. **No DaisyUI**, no React/Vue/Svelte,
  no bundler, no npm build.

### Single-page shell
`dashboard.html` is the app shell. It loads Tailwind + HTMX + Alpine **once** and the
inline `tailwind.config`. Every other template is a **fragment** swapped into
`#main-content`. Therefore:

- **Fragments must NOT contain** `<!DOCTYPE>`, `<html>`, `<head>`, `<body>`, or
  `<script src>` for Tailwind/HTMX/Alpine. Only `dashboard.html` and `login.html` own
  the document shell.
- The design tokens below are defined once in the shell's inline config, so every
  fragment can use `primary-*`, `shadow-card`, etc.

---

## Design tokens (defined in the inline `tailwind.config`)

| Token | Value | Use for |
|---|---|---|
| `primary` / `brand` (50–900) | indigo scale | primary actions, active nav, focus rings, accents |
| `shadow-card` | subtle | resting cards, panels |
| `shadow-card-hover` | lifted | card hover state |
| `rounded-xl` (0.75rem) | | cards, panels, modals |
| `rounded-lg` | | buttons, inputs, badges |

### Neutrals
`gray-50` page bg · `white` surfaces · `gray-200` borders · `gray-900` headings ·
`gray-600` body text · `gray-400` muted/meta.

### Semantic colors
Success `green-600` · Warning `amber-500` · Danger `red-600` · Info `blue-600`.
Use the `-50/-100` tints for soft backgrounds (badges, alerts).

---

## Canonical component classes

Copy these verbatim. If a component needs a variation, extend — don't reinvent.

**Card (surface)**
```
rounded-xl border border-gray-200 bg-white shadow-card
```
**Card hover (interactive card)**
```
rounded-xl border border-gray-200 bg-white shadow-card transition hover:shadow-card-hover
```
**Card body padding:** `p-6`

**Primary button**
```
inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-1
```
**Secondary button**
```
inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-400
```
**Danger button**
```
inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400
```
**Icon button (round)**
```
inline-flex h-10 w-10 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-400
```
Tinted icon-button variants: swap in `bg-primary-50 text-primary-600 hover:bg-primary-100`
(brand) or the equivalent semantic tint.

**Badge / pill**
```
inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
```
Then add a color pair: `bg-primary-100 text-primary-700`, `bg-green-100 text-green-700`,
`bg-amber-100 text-amber-700`, `bg-gray-100 text-gray-600`.

**Text input / select**
```
block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-400
```
**Label:** `block text-sm font-medium text-gray-700 mb-1`

**Modal overlay**
```
fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4
```
**Modal panel**
```
w-full max-w-md rounded-xl bg-white p-6 shadow-xl
```
Prefer driving open/close with Alpine (`x-data`/`x-show`) or HTMX OOB swaps — never a
JS modal library.

**Empty state**
```
flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 py-10 text-center text-gray-500
```
(icon `w-8 h-8 mb-2 text-gray-400`, then a `text-sm` line)

**Table**
```
min-w-full text-sm text-left text-gray-700
```
Header row: `bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500`
Cells: `px-4 py-2`. Rows: `border-b border-gray-100 hover:bg-gray-50`.
Wrap wide tables in `<div class="overflow-x-auto">`.

---

## Typography scale
- Page title `text-2xl font-bold text-gray-900`
- Section heading `text-lg font-semibold text-gray-900`
- Card title `text-base font-semibold text-gray-900`
- Body `text-sm text-gray-600`
- Meta/caption `text-xs text-gray-400`

## Spacing rhythm
Section gap `space-y-6` / `mb-6` · in-card gap `gap-4` · inline gap `gap-2`.
Container: `mx-auto w-full max-w-5xl`.

## Icons
Inline SVG, Heroicons outline style, `stroke-width="2"`, size `w-5 h-5` (buttons)
or `w-4 h-4` (inline). Keep one visual family.

---

## Migration notes (dead classes to replace)
These were written for DaisyUI/undefined palettes and currently render as nothing —
replace on sight:
- `card`, `card-body`, `card-actions` → the Card classes above
- `badge`, `badge-primary` → the Badge classes above
- `bg-base-100` → `bg-white` · `text-base-content` → `text-gray-900`
  · `text-base-content/70` → `text-gray-600` · `border-base-300` → `border-gray-200`
- `data-theme="dark"` (DaisyUI attribute) → remove; use Tailwind `dark:` + `darkMode:'class'`
- `primary-*` classes now WORK (defined in config) — no change needed, they're brand indigo.

## Regeneration prompt guardrails
Paste the block from the redesign plan at the top of every Fable prompt. Summary:
keep all `hx-*` + Alpine + Go template directives; no frameworks/build; fragments carry
no document shell; follow this file for all colors/spacing/components; output the full file.
