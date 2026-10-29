import { useState, type FormEvent } from 'react'
import { usePublish, usePublished } from '@/lib/queries'
import { ApiError } from '@/lib/api'
import { Dialog } from '@/components/Dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Publishes the Working list: it becomes the published list everyone
 * reads, as the next Published #. The note is optional.
 */
export function PublishDialog({
  projectId,
  onClose,
  onPublished,
}: {
  projectId: number
  onClose: () => void
  onPublished: () => void
}) {
  const publish = usePublish(projectId)
  const published = usePublished(projectId)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  const last = published.data?.publish_number ?? 0
  const next = published.isSuccess ? last + 1 : null

  async function handlePublish(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      await publish.mutateAsync({ notes: notes.trim() })
      onPublished()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    }
  }

  return (
    <Dialog title={next ? `Publish as #${next}` : 'Publish'} onClose={onClose}>
      <form onSubmit={handlePublish} noValidate>
        <div className="space-y-3 p-4">
          <p className="text-xs text-muted">
            The list as it is right now becomes the published list that everyone on the project reads.
            {last > 0 ? ` It replaces Published #${last}, which stays in Versions.` : ''} You can keep working
            here afterwards; changes show in the published list only when you publish again.
          </p>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <Input
            label="Note (optional)"
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What changed, e.g. Added payments, split checkout"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={publish.isPending}>
            Publish
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
