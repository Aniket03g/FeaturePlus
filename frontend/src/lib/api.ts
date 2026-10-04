/**
 * The client for /api/v1.
 *
 * Every response is enveloped: {data} or {data, meta} on success, and
 * {error: {code, message, fields}} on failure. This module unwraps the
 * envelope so callers deal in payloads, and turns a failure into a typed
 * ApiError carrying the code and any per-field messages a form needs.
 *
 * Authentication rides on an HttpOnly cookie, which scripts cannot read. That
 * is why credentials are always included and why identity comes from /me
 * rather than from decoding a token here.
 */

const BASE = '/api/v1'

export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'internal_error'

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | string,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly status = 0,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** True when the session is missing or expired, so the app should sign out. */
  get isAuthFailure() {
    return this.code === 'unauthorized' || this.status === 401
  }
}

export interface Meta {
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface Paged<T> {
  items: T[]
  meta: Meta
}

interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
  query?: Record<string, string | number | boolean | undefined>
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<{ data: T; meta?: Meta }> {
  const { method = 'GET', body, signal, query } = options

  const url = new URL(BASE + path, window.location.origin)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  const response = await fetch(url, {
    method,
    signal,
    credentials: 'include',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  // 204 carries no body, which JSON.parse would choke on.
  if (response.status === 204) return { data: undefined as T }

  const text = await response.text()
  let payload: unknown
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    // A non-JSON body means something upstream of the API answered — a proxy,
    // or the server being down. Report that rather than a parse error.
    throw new ApiError('internal_error', 'The server sent an unreadable response', {}, response.status)
  }

  if (!response.ok) {
    const err = (payload as { error?: { code?: string; message?: string; fields?: Record<string, string> } }).error
    throw new ApiError(
      err?.code ?? 'internal_error',
      err?.message ?? `Request failed (${response.status})`,
      err?.fields ?? {},
      response.status,
    )
  }

  const envelope = payload as { data: T; meta?: Meta }
  return { data: envelope.data, meta: envelope.meta }
}

/** Fetch a single resource. */
export async function get<T>(path: string, options?: RequestOptions): Promise<T> {
  return (await request<T>(path, options)).data
}

/** Fetch a collection along with its pagination metadata. */
export async function list<T>(path: string, options?: RequestOptions): Promise<Paged<T>> {
  const { data, meta } = await request<T[]>(path, options)
  return {
    items: data ?? [],
    meta: meta ?? { total: data?.length ?? 0, page: 1, per_page: data?.length ?? 0, total_pages: 1 },
  }
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  return (await request<T>(path, { method: 'POST', body })).data
}

export async function patch<T>(path: string, body: unknown): Promise<T> {
  return (await request<T>(path, { method: 'PATCH', body })).data
}

export async function request_put<T>(path: string, body: unknown): Promise<T> {
  return (await request<T>(path, { method: 'PUT', body })).data
}

export async function del(path: string): Promise<void> {
  await request<void>(path, { method: 'DELETE' })
}

/**
 * Send a file as multipart/form-data.
 *
 * This is the one request that is not JSON. The Content-Type header is left
 * unset on purpose: the browser has to add it itself so it can include the
 * multipart boundary, and setting it here produces a body the server cannot
 * parse.
 */
export async function upload<T>(path: string, file: File, field = 'file'): Promise<T> {
  const body = new FormData()
  body.append(field, file)

  const response = await fetch(new URL(BASE + path, window.location.origin), {
    method: 'POST',
    credentials: 'include',
    body,
  })

  const text = await response.text()
  let payload: unknown
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    throw new ApiError('internal_error', 'The server sent an unreadable response', {}, response.status)
  }

  if (!response.ok) {
    const err = (payload as { error?: { code?: string; message?: string; fields?: Record<string, string> } }).error
    throw new ApiError(
      err?.code ?? 'internal_error',
      err?.message ?? `Upload failed (${response.status})`,
      err?.fields ?? {},
      response.status,
    )
  }

  return (payload as { data: T }).data
}

/** The URL a file is served from, for a link or an <img> src. */
export function fileUrl(path: string, params: Record<string, string> = {}) {
  const url = new URL(BASE + path, window.location.origin)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}
