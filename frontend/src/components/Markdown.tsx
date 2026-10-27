import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ImageOff } from 'lucide-react'
import { fileUrl } from '@/lib/api'
import type { FeatureAttachment } from '@/lib/types'
import { cn } from '@/lib/utils'

/** How a description links to one of its feature's files: `![shot](attachment:shot.png)`. */
export const ATTACHMENT_SCHEME = 'attachment:'

/** The markdown that shows or links to a file, as the editor inserts it. */
export function attachmentMarkdown(file: Pick<FeatureAttachment, 'name' | 'mime_type'>) {
  const link = `${ATTACHMENT_SCHEME}${file.name}`
  return file.mime_type.startsWith('image/') ? `![${file.name}](${link})` : `[${file.name}](${link})`
}

function attachmentUrl(file: FeatureAttachment, inline: boolean) {
  return fileUrl(`/feature-attachments/${file.id}/content`, inline ? { disposition: 'inline' } : {})
}

/**
 * Markdown as the feature page shows it: headings, lists, tables, checklists,
 * code, links and pictures.
 *
 * Links to `attachment:<name>` are looked up among the feature's files, so the
 * text names a file rather than a server address and stays right when a
 * backup is restored somewhere else. Raw HTML in the text is shown as text,
 * never run.
 */
export function Markdown({
  text,
  attachments = [],
  className,
}: {
  text: string
  attachments?: FeatureAttachment[]
  className?: string
}) {
  const byName = new Map(attachments.map((a) => [a.name.toLowerCase(), a]))
  const find = (url?: string) =>
    url?.startsWith(ATTACHMENT_SCHEME)
      ? { file: byName.get(decodeURIComponent(url.slice(ATTACHMENT_SCHEME.length)).toLowerCase()) ?? null }
      : null

  const components: Components = {
    h1: ({ node: _, ...props }) => <h1 className="mt-5 mb-2 text-lg font-semibold text-ink first:mt-0" {...props} />,
    h2: ({ node: _, ...props }) => <h2 className="mt-4 mb-2 text-base font-semibold text-ink first:mt-0" {...props} />,
    h3: ({ node: _, ...props }) => <h3 className="mt-3 mb-1.5 text-sm font-semibold text-ink first:mt-0" {...props} />,
    p: ({ node: _, ...props }) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
    ul: ({ node: _, ...props }) => <ul className="my-2 list-disc space-y-1 pl-5" {...props} />,
    ol: ({ node: _, ...props }) => <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />,
    blockquote: ({ node: _, ...props }) => (
      <blockquote className="my-2 border-l-2 border-border pl-3 text-faint" {...props} />
    ),
    hr: () => <hr className="my-4 border-border" />,
    code: ({ node: _, className: lang, ...props }) => (
      <code className={cn('rounded bg-raised px-1 py-0.5 font-mono text-[0.85em] text-ink', lang)} {...props} />
    ),
    pre: ({ node: _, ...props }) => (
      <pre className="my-2 overflow-x-auto rounded-md border border-border bg-raised p-3 text-xs [&_code]:bg-transparent [&_code]:p-0" {...props} />
    ),
    table: ({ node: _, ...props }) => (
      <div className="my-2 overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs" {...props} />
      </div>
    ),
    th: ({ node: _, ...props }) => <th className="border border-border bg-raised px-2 py-1 font-semibold text-ink" {...props} />,
    td: ({ node: _, ...props }) => <td className="border border-border px-2 py-1" {...props} />,
    a: ({ node: _, href, children, ...props }) => {
      const found = find(href)
      if (found && !found.file) {
        return <span className="text-danger line-through" title="This file is no longer attached">{children}</span>
      }
      return (
        <a
          {...props}
          href={found?.file ? attachmentUrl(found.file, false) : href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent underline underline-offset-2 hover:text-accent-hover"
        >
          {children}
        </a>
      )
    },
    img: ({ node: _, src, alt }) => {
      const found = find(src)
      if (found && !found.file) {
        return (
          <span className="my-1 inline-flex items-center gap-1.5 rounded border border-dashed border-border px-2 py-1 text-xs text-faint">
            <ImageOff className="h-3.5 w-3.5" />
            {alt || 'Picture'} is no longer attached
          </span>
        )
      }
      const url = found?.file ? attachmentUrl(found.file, true) : src
      return (
        <a href={url} target="_blank" rel="noreferrer noopener" className="inline-block">
          <img src={url} alt={alt ?? ''} loading="lazy" className="my-1 max-h-[32rem] max-w-full rounded border border-border" />
        </a>
      )
    },
  }

  return (
    <div className={cn('break-words text-sm leading-relaxed text-muted', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        // The default drops links in schemes it does not know; attachment
        // links are kept for the img and a renderers above to resolve.
        urlTransform={(url) => (url.startsWith(ATTACHMENT_SCHEME) ? url : defaultUrlTransform(url))}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
