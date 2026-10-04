# UI Redesign — Change Log (Session 2026-07-19)

Foundation for migrating the FeaturePlus UI to **pure Tailwind** (option 2: no DaisyUI,
no framework, no build step). Documents every change made in this session.

---

## Background / key findings

- **DaisyUI was never loaded.** The word `daisyui` appears in zero files — no CDN
  `<script>`, no `<link>`, no config. Only Tailwind CDN + HTMX 1.9.10 + Alpine.js load.
- As a result, many class names in the templates were **inert (dead)**:
  - DaisyUI classes: `card`, `card-body`, `card-actions`, `badge`, `badge-primary`,
    `bg-base-100`, `text-base-content`, `border-base-300`.
  - `primary-*` classes (`bg-primary-100`, `text-primary-700`, `focus:ring-primary-500`…) —
    Tailwind has no default `primary` palette, so these rendered as nothing too.
- **Architecture:** the app is an **HTMX single-page shell**. `dashboard.html` loads
  Tailwind/HTMX/Alpine once and injects every other template as a **fragment** into
  `#main-content`. So the design config only needs to live in the shell (and `login.html`),
  and fragments must never carry their own `<head>`/`<script>`.

---

## Files changed

### 1. `backend/templates/dashboard.html` (app shell) — MODIFIED
Added an inline `tailwind.config` block right after the Tailwind CDN `<script>`.
Defines the brand token system (CDN Tailwind has no config file):
- `primary` and `brand` color palettes (indigo scale, 50–900)
- `borderRadius`: `xl` (0.75rem), `2xl` (1rem)
- `boxShadow`: `card`, `card-hover`
- `darkMode: 'class'`

**Effect:** instantly revives all previously-dead `primary-*` classes across the whole
app (they now render as brand indigo), and makes `shadow-card` etc. available to every
fragment.

### 2. `backend/templates/login.html` — MODIFIED
Added the same inline `tailwind.config` block (the login page renders outside the shell,
so it needs its own copy).

### 3. `backend/templates/DESIGN.md` — NEW
The single source of truth for all styling. Contents:
- Stack constraints (keep all `hx-*`, Alpine, and Go template directives; no frameworks/
  build; fragments carry no document shell).
- Design tokens table (colors, shadows, radii, neutrals, semantic colors).
- **Copy-paste canonical class strings** for: card, card-hover, primary/secondary/danger
  buttons, icon button, badge, input/select, label, modal overlay + panel, empty state,
  table.
- Typography scale, spacing rhythm, icon conventions.
- Migration cheat-sheet mapping each dead DaisyUI/`base-*` class to its Tailwind
  replacement.
- Regeneration prompt guardrails for Claude Fable.

### 4. `backend/templates/task-card.html` — MODIFIED (proof-of-concept)
Converted the dead DaisyUI/`base-*` classes in the card header/container to real Tailwind:
- Container `card bg-base-100 shadow-md border border-base-300` →
  `rounded-xl border border-gray-200 bg-white shadow-card transition hover:shadow-card-hover`
- `card-body` → plain padding/flex utilities
- `badge badge-primary` (task type) →
  `inline-flex items-center rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-700`
- `text-base-content` → `text-gray-900`; `text-base-content/70` → `text-gray-600`
- `card-actions` wrapper → plain flex utilities
- Toggle + guidance + edit icon buttons standardized to the DESIGN.md icon-button pattern.

**Preserved untouched:** every `hx-get/post/target/swap/trigger`, all Alpine
`x-data`/`x-show`/`@click`/`:class`, all Go `{{ ... }}` directives and
`id="...-{{ .Task.ID }}"` targets, and the embedded release-mode/copy-branch `<script>`
blocks. The expandable card body already used valid Tailwind and was left for the batch pass.

---

## Verification

- `go run main.go` boots cleanly — templates parse via `LoadHTMLGlob` with no panic,
  confirming the edited `dashboard.html`, `login.html`, and `task-card.html` are valid.
- `GET /web/login` returns **HTTP 200**.

### Note (pre-existing, not caused by this work)
`go build ./...` fails because three stray helper files each declare `main`:
`debug_templates.go`, `test_role_based_views.go`, `test_role_middleware.go`.
Unrelated to the UI changes (only `.html`/`.md` were touched). The app runs via
`go run main.go`, which is unaffected.

---

## Next steps

1. Convert the **card family** next: `feature-card.html`, `task-card-simple.html`.
2. Then modals, then forms, then tables — one component family at a time.
3. For Fable-driven batches: point it at `backend/templates/DESIGN.md`, paste the
   guardrail block, and verify each batch with `go run main.go`.
