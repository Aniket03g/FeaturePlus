import { useState, type ReactNode } from 'react'
import { Info, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  useProject,
  useProjectSettings,
  useUpdateProject,
  useUpdateProjectSettings,
  type ProjectSettings as Settings,
  type ProjectSettingsEntry as SettingsEntry,
} from '@/lib/queries'
import { ApiError } from '@/lib/api'
import { canEditInfo, statusLabel, type StatusDef, type StatusParamType } from '@/lib/types'
import { StatusPill } from '@/components/FeatureBits'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Markdown } from '@/components/Markdown'
import { MarkdownEditor } from '@/components/MarkdownEditor'
import { FEATURE_COLORS } from '@/components/FeatureColor'

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const SECTIONS = [
  ['about', 'About'],
  ['prompts', 'Prompts'],
  ['conventions', 'Conventions'],
  ['statuses', 'Statuses'],
] as const

/**
 * Project info: what the project is, and the prompts and conventions its team
 * works by. Everyone on the project reads it; the owner and publishers edit
 * it, one section at a time.
 */
export function ProjectSettings({ projectId }: { projectId: number }) {
  const project = useProject(projectId)
  const settings = useProjectSettings(projectId)
  const mayEdit = canEditInfo(project.data?.my_role)

  if (project.isLoading || settings.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (project.isError || settings.isError || !project.data || !settings.data) {
    return (
      <Card>
        <CardBody className="text-sm text-danger">Could not load the project info.</CardBody>
      </Card>
    )
  }

  const s = settings.data
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <Info className="h-4 w-4 text-faint" />
            Project info
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            What this project is, and the prompts and conventions the team works by.
            {!mayEdit && ' Only the owner can change it.'}
          </p>
        </div>
        <nav className="flex gap-1 text-xs" aria-label="Sections">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-md px-2.5 py-1 text-muted hover:bg-raised hover:text-ink">
              {label}
            </a>
          ))}
        </nav>
      </div>

      <AboutSection projectId={projectId} mayEdit={mayEdit} />
      <PromptsSection projectId={projectId} settings={s} mayEdit={mayEdit} />
      <ConventionsSection projectId={projectId} settings={s} mayEdit={mayEdit} />
      <StatusesSection projectId={projectId} settings={s} mayEdit={mayEdit} />

      {s.updated_at && (
        <p className="text-xs text-faint">
          Last changed {when(s.updated_at)}
          {s.updated_by ? ` by ${s.updated_by}` : ''}
        </p>
      )}
    </div>
  )
}

/** A section: its title, an Edit button for those who may, and its body. */
function Section({
  id,
  title,
  hint,
  editing,
  onEdit,
  children,
}: {
  id: string
  title: string
  hint?: string
  editing: boolean
  /** Missing when the person cannot edit. */
  onEdit?: () => void
  children: ReactNode
}) {
  return (
    <Card id={id} className="scroll-mt-20">
      <CardBody className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
          </div>
          {onEdit && !editing && (
            <Button variant="secondary" size="sm" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </div>
        {children}
      </CardBody>
    </Card>
  )
}

/** Save and Cancel under a section being edited, with any error. */
function EditActions({ saving, error, onCancel, onSave }: { saving: boolean; error: string; onCancel: () => void; onSave: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
      {error && (
        <p role="alert" className="mr-auto text-xs text-danger">
          {error}
        </p>
      )}
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="sm" loading={saving} onClick={onSave}>
        Save
      </Button>
    </div>
  )
}

function errorText(err: unknown) {
  if (err instanceof ApiError) {
    const fields = Object.values(err.fields)
    return fields.length > 0 ? fields.join(' · ') : err.message
  }
  return 'Could not reach the server'
}

// ---------- About ----------

function AboutSection({ projectId, mayEdit }: { projectId: number; mayEdit: boolean }) {
  const project = useProject(projectId)
  const update = useUpdateProject(projectId)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const p = project.data!

  function start() {
    setName(p.name)
    setDescription(p.description ?? '')
    setError('')
    setEditing(true)
  }

  async function save() {
    if (!name.trim()) {
      setError('Give the project a name')
      return
    }
    setError('')
    try {
      await update.mutateAsync({ name: name.trim(), description: description.trim() })
      setEditing(false)
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <Section id="about" title="About" editing={editing} onEdit={mayEdit ? start : undefined}>
      {editing ? (
        <>
          <Input label="Name" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} autoFocus />
          <label className="block space-y-1.5">
            <span className="block text-xs font-medium text-muted">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={10000}
              placeholder="What the project is and who it is for"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </label>
          <EditActions saving={update.isPending} error={error} onCancel={() => setEditing(false)} onSave={save} />
        </>
      ) : (
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-xs font-medium text-muted">Name</dt>
          <dd className="text-ink">{p.name}</dd>
          <dt className="text-xs font-medium text-muted">Description</dt>
          <dd className="whitespace-pre-wrap text-ink">{p.description || <span className="text-faint">No description yet</span>}</dd>
          <dt className="text-xs font-medium text-muted">Owner</dt>
          <dd className="text-ink">{p.owner?.name || p.owner?.username || '—'}</dd>
          <dt className="text-xs font-medium text-muted">Created</dt>
          <dd className="text-ink">{when(p.created_at)}</dd>
        </dl>
      )}
    </Section>
  )
}

// ---------- Prompts and conventions ----------

const MAX_ENTRIES = 50

type EntryDraft = { title: string; body: string }

/** A list of titled markdown entries, as they are edited. */
function EntriesEditor({
  idPrefix,
  entries,
  setEntries,
  addLabel,
  titlePlaceholder,
}: {
  idPrefix: string
  entries: EntryDraft[]
  setEntries: (update: (now: EntryDraft[]) => EntryDraft[]) => void
  addLabel: string
  titlePlaceholder: string
}) {
  return (
    <div className="space-y-3">
      {entries.map((entry, i) => (
        <div key={i} className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <Input
              value={entry.title}
              maxLength={120}
              placeholder={titlePlaceholder}
              onChange={(e) =>
                setEntries((now) => now.map((row, idx) => (idx === i ? { ...row, title: e.target.value } : row)))
              }
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEntries((now) => now.filter((_, idx) => idx !== i))}
              aria-label="Remove entry"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <MarkdownEditor
            id={`${idPrefix}-${i}`}
            label={entry.title.trim() || `Entry ${i + 1}`}
            value={entry.body}
            onChange={(body) =>
              setEntries((now) => now.map((row, idx) => (idx === i ? { ...row, body } : row)))
            }
            featureId={0}
            attachments={[]}
            height="12rem"
            placeholder="Write it in Markdown"
            canUpload={false}
            focusOnOpen={false}
          />
        </div>
      ))}
      {entries.length < MAX_ENTRIES && (
        <Button variant="secondary" size="sm" onClick={() => setEntries((now) => [...now, { title: '', body: '' }])}>
          <Plus className="h-3.5 w-3.5" />
          {addLabel}
        </Button>
      )}
    </div>
  )
}

/** Titled entries as they read when not editing. */
function EntriesView({ entries, empty }: { entries: SettingsEntry[]; empty: string }) {
  if (entries.length === 0) return <p className="text-sm text-faint">{empty}</p>
  return (
    <div className="space-y-5">
      {entries.map((entry, i) => (
        <div key={i}>
          <h4 className="text-sm font-semibold text-ink">{entry.title}</h4>
          {entry.body ? (
            <Markdown text={entry.body} className="mt-1 text-sm" />
          ) : (
            <p className="mt-1 text-sm text-faint">No body yet.</p>
          )}
        </div>
      ))}
    </div>
  )
}

/** Trim drafts and drop the ones left entirely blank. */
function cleanEntries(entries: EntryDraft[]): SettingsEntry[] {
  return entries
    .filter((e) => e.title.trim() || e.body.trim())
    .map((e) => ({ title: e.title.trim(), body: e.body.trim() }))
}

/** The first entry with a body but no title, if any. */
function untitled(entries: EntryDraft[]) {
  return entries.some((e) => e.body.trim() && !e.title.trim())
}

function PromptsSection({ projectId, settings, mayEdit }: { projectId: number; settings: Settings; mayEdit: boolean }) {
  const update = useUpdateProjectSettings(projectId)
  const [editing, setEditing] = useState(false)
  const [entries, setEntries] = useState<EntryDraft[]>([])
  const [error, setError] = useState('')

  function start() {
    setEntries(settings.prompts.map((e) => ({ title: e.title, body: e.body })))
    setError('')
    setEditing(true)
  }

  async function save() {
    setError('')
    if (untitled(entries)) {
      setError('Give every prompt a title')
      return
    }
    try {
      await update.mutateAsync({ prompts: cleanEntries(entries) })
      setEditing(false)
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <Section
      id="prompts"
      title="Prompts"
      hint="Instructions for working on this project: architecture, UI standards, or anything else the team should keep in mind. Each has a title and a body."
      editing={editing}
      onEdit={mayEdit ? start : undefined}
    >
      {editing ? (
        <>
          <EntriesEditor
            idPrefix="prompt"
            entries={entries}
            setEntries={setEntries}
            addLabel="Add prompt"
            titlePlaceholder="Title, e.g. UI standards"
          />
          <EditActions saving={update.isPending} error={error} onCancel={() => setEditing(false)} onSave={save} />
        </>
      ) : (
        <EntriesView entries={settings.prompts} empty="No prompts yet." />
      )}
    </Section>
  )
}

function ConventionsSection({ projectId, settings, mayEdit }: { projectId: number; settings: Settings; mayEdit: boolean }) {
  const update = useUpdateProjectSettings(projectId)
  const [editing, setEditing] = useState(false)
  const [entries, setEntries] = useState<EntryDraft[]>([])
  const [colors, setColors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  function start() {
    setEntries(settings.conventions.map((e) => ({ title: e.title, body: e.body })))
    setColors({ ...settings.color_meanings })
    setError('')
    setEditing(true)
  }

  async function save() {
    setError('')
    if (untitled(entries)) {
      setError('Give every convention a title')
      return
    }
    try {
      await update.mutateAsync({ conventions: cleanEntries(entries), color_meanings: colors })
      setEditing(false)
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <Section
      id="conventions"
      title="Conventions"
      hint="How the team works: branching, reviews, releases, and what each feature colour means. A colour has a convention chosen for it rather than a free-form body."
      editing={editing}
      onEdit={mayEdit ? start : undefined}
    >
      {editing ? (
        <>
          {settings.conventions_default && (
            <p className="text-2xs text-faint">Starting conventions. Edit them to fit how your team works.</p>
          )}
          <EntriesEditor
            idPrefix="convention"
            entries={entries}
            setEntries={setEntries}
            addLabel="Add convention"
            titlePlaceholder="Title, e.g. Branching"
          />
          <ColorMeanings editing saved={settings.color_meanings} colors={colors} setColors={setColors} />
          <EditActions saving={update.isPending} error={error} onCancel={() => setEditing(false)} onSave={save} />
        </>
      ) : (
        <>
          {settings.conventions_default && (
            <p className="text-2xs text-faint">Starting conventions. Edit them to fit how your team works.</p>
          )}
          <EntriesView entries={settings.conventions} empty="No conventions written yet." />
          <ColorMeanings
            editing={false}
            saved={settings.color_meanings}
            colors={settings.color_meanings}
            setColors={() => {}}
          />
        </>
      )}
    </Section>
  )
}

// ---------- Statuses ----------

const MAX_STATUSES = 12
const MAX_STATUS_PARAMS = 3

type EditParam = { ui_name: string; type: StatusParamType }
type EditStatus = { name: string; params: EditParam[] }

/** Turn a UI name into the JSON key the value is stored under, matching the server. */
function keyOf(uiName: string) {
  return uiName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * The feature statuses this project offers, and the parameters each one
 * carries. A parameter is a named field (its UI name) of a given type; its
 * value is filled in per feature when the feature takes that status.
 */
function StatusesSection({ projectId, settings, mayEdit }: { projectId: number; settings: Settings; mayEdit: boolean }) {
  const update = useUpdateProjectSettings(projectId)
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<EditStatus[]>([])
  const [error, setError] = useState('')

  function start() {
    setRows(
      settings.statuses.map((d) => ({
        name: d.name,
        params: d.params.map((p) => ({ ui_name: p.ui_name, type: p.type })),
      })),
    )
    setError('')
    setEditing(true)
  }

  function addStatus() {
    setRows((r) => (r.length >= MAX_STATUSES ? r : [...r, { name: '', params: [] }]))
  }
  function removeStatus(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i))
  }
  function setStatusName(i: number, name: string) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, name } : row)))
  }
  function addParam(i: number) {
    setRows((r) =>
      r.map((row, idx) =>
        idx === i && row.params.length < MAX_STATUS_PARAMS
          ? { ...row, params: [...row.params, { ui_name: '', type: 'string' }] }
          : row,
      ),
    )
  }
  function removeParam(i: number, j: number) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, params: row.params.filter((_, k) => k !== j) } : row)))
  }
  function setParam(i: number, j: number, patch: Partial<EditParam>) {
    setRows((r) =>
      r.map((row, idx) =>
        idx === i
          ? { ...row, params: row.params.map((p, k) => (k === j ? { ...p, ...patch } : p)) }
          : row,
      ),
    )
  }

  async function save() {
    setError('')
    const statuses: StatusDef[] = rows
      .filter((r) => r.name.trim() !== '')
      .map((r) => ({
        name: r.name.trim(),
        params: r.params
          .filter((p) => p.ui_name.trim() !== '')
          .map((p) => ({ ui_name: p.ui_name.trim(), key: keyOf(p.ui_name), type: p.type })),
      }))
    if (statuses.length === 0) {
      setError('Define at least one status')
      return
    }
    try {
      await update.mutateAsync({ statuses })
      setEditing(false)
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <Section
      id="statuses"
      title="Statuses"
      hint="The statuses a feature can take, and the details each one records. Values are filled in per feature."
      editing={editing}
      onEdit={mayEdit ? start : undefined}
    >
      {editing ? (
        <div className="space-y-3">
          {rows.map((row, i) => (
            <div key={i} className="rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <Input
                  value={row.name}
                  maxLength={40}
                  placeholder="Status name, e.g. In progress"
                  onChange={(e) => setStatusName(i, e.target.value)}
                  className="flex-1"
                />
                <Button variant="ghost" size="sm" onClick={() => removeStatus(i)} aria-label="Remove status">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-2 space-y-1.5 pl-3">
                {row.params.map((p, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <Input
                      value={p.ui_name}
                      maxLength={40}
                      placeholder="Parameter, e.g. Assignee"
                      onChange={(e) => setParam(i, j, { ui_name: e.target.value })}
                      className="flex-1"
                    />
                    <select
                      value={p.type}
                      onChange={(e) => setParam(i, j, { type: e.target.value as StatusParamType })}
                      className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
                    >
                      <option value="string">Text</option>
                      <option value="integer">Number</option>
                    </select>
                    <Button variant="ghost" size="sm" onClick={() => removeParam(i, j)} aria-label="Remove parameter">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                {row.params.length < MAX_STATUS_PARAMS && (
                  <Button variant="ghost" size="sm" onClick={() => addParam(i)}>
                    <Plus className="h-3.5 w-3.5" />
                    Add parameter
                  </Button>
                )}
              </div>
            </div>
          ))}
          {rows.length < MAX_STATUSES && (
            <Button variant="secondary" size="sm" onClick={addStatus}>
              <Plus className="h-3.5 w-3.5" />
              Add status
            </Button>
          )}
          <div className="rounded-md bg-raised p-2">
            <p className="mb-1 text-2xs uppercase tracking-wide text-faint">Preview</p>
            <div className="flex flex-wrap items-center gap-3">
              {rows.filter((r) => r.name.trim()).map((r, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  <StatusPill status={r.name.trim()} />
                  {r.params.filter((p) => p.ui_name.trim()).length > 0 && (
                    <span className="text-2xs text-faint">
                      ({r.params.filter((p) => p.ui_name.trim()).map((p) => p.ui_name.trim()).join(', ')})
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
          <EditActions saving={update.isPending} error={error} onCancel={() => setEditing(false)} onSave={save} />
        </div>
      ) : (
        <div className="space-y-2">
          {settings.statuses_default && (
            <p className="text-2xs text-faint">Default statuses. Edit to define your own.</p>
          )}
          <ul className="space-y-1.5 text-sm">
            {settings.statuses.map((d) => (
              <li key={d.name} className="flex flex-wrap items-center gap-2">
                <StatusPill status={d.name} label={statusLabel(d.name)} />
                {d.params.length > 0 && (
                  <span className="text-xs text-muted">
                    {d.params.map((p) => `${p.ui_name} (${p.type === 'integer' ? 'number' : 'text'})`).join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  )
}

/**
 * The colours the team has given a meaning. Only those are listed; more are
 * added one at a time, from the colours not used yet.
 */
function ColorMeanings({
  editing,
  saved,
  colors,
  setColors,
}: {
  editing: boolean
  saved: Record<string, string>
  colors: Record<string, string>
  setColors: (update: (now: Record<string, string>) => Record<string, string>) => void
}) {
  const [adding, setAdding] = useState(false)
  const shown = editing ? colors : saved
  const listed = FEATURE_COLORS.filter((c) => c.name in shown && (editing || shown[c.name]))
  const unused = FEATURE_COLORS.filter((c) => !(c.name in colors))

  return (
    <div>
      <h4 className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-faint">Colour conventions</h4>
      <p className="mb-2 text-xs text-muted">Choose what each feature colour means for this project.</p>
      {listed.length === 0 && !editing && (
        <p className="text-sm text-faint">No colour conventions yet.</p>
      )}
      {listed.length > 0 && (
        <div className="space-y-2">
          {listed.map((c) => (
            <div key={c.name} className="flex max-w-xl items-center gap-2.5">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.hex }} aria-hidden />
              <span className="w-16 shrink-0 text-xs text-muted">{c.label}</span>
              {editing ? (
                <>
                  <input
                    value={colors[c.name] ?? ''}
                    maxLength={80}
                    autoFocus={colors[c.name] === ''}
                    onChange={(e) => setColors((now) => ({ ...now, [c.name]: e.target.value }))}
                    placeholder="What it means, e.g. Blocked"
                    aria-label={`What ${c.label.toLowerCase()} means`}
                    className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setColors((now) => {
                        const next = { ...now }
                        delete next[c.name]
                        return next
                      })
                    }
                    aria-label={`Remove ${c.label.toLowerCase()}`}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint hover:bg-raised hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <span className="min-w-0 truncate text-sm text-ink">{shown[c.name]}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {editing && unused.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {adding ? (
            <>
              <span className="text-xs text-muted">Pick a colour:</span>
              {unused.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => {
                    setColors((now) => ({ ...now, [c.name]: '' }))
                    setAdding(false)
                  }}
                  title={c.label}
                  aria-label={`Add ${c.label.toLowerCase()}`}
                  className="grid h-7 w-7 place-items-center rounded-full hover:bg-raised"
                >
                  <span className="block h-4 w-4 rounded-full" style={{ background: c.hex }} />
                </button>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add a colour
            </Button>
          )}
        </div>
      )}
      {!editing && listed.length > 0 && (
        <p className="mt-2 text-2xs text-faint">These show in the Colours legend on the Feature List.</p>
      )}
    </div>
  )
}
