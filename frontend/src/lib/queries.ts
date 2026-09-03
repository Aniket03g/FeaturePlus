import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from './api'
import type { Feature, Project, TagCount } from './types'

/**
 * Query keys are declared in one place so that an invalidation after a write
 * cannot miss a cache entry through a typo in a hand-written key.
 */
export const keys = {
  projects: (params?: unknown) => ['projects', params ?? {}] as const,
  project: (id: number) => ['project', id] as const,
  features: (projectId: number, params?: unknown) =>
    ['features', projectId, params ?? {}] as const,
  feature: (id: number) => ['feature', id] as const,
  tags: (projectId: number) => ['tags', projectId] as const,
}

export interface FeatureFilters {
  status?: string[]
  priority?: string[]
  tag?: string
  q?: string
}

/** Turn the filter state into the query parameters the API expects. */
function featureQuery(filters: FeatureFilters) {
  return {
    status: filters.status?.length ? filters.status.join(',') : undefined,
    priority: filters.priority?.length ? filters.priority.join(',') : undefined,
    tag: filters.tag || undefined,
    q: filters.q || undefined,
    per_page: 200,
  }
}

export function useProjects(params: { page?: number; q?: string; per_page?: number } = {}) {
  return useQuery({
    queryKey: keys.projects(params),
    queryFn: () => api.list<Project>('/projects', { query: params }),
    placeholderData: (previous) => previous,
  })
}

export function useProject(id: number) {
  return useQuery({
    queryKey: keys.project(id),
    queryFn: () => api.get<Project>(`/projects/${id}`),
    enabled: id > 0,
  })
}

export function useFeatures(projectId: number, filters: FeatureFilters) {
  return useQuery({
    queryKey: keys.features(projectId, filters),
    queryFn: () => api.list<Feature>(`/projects/${projectId}/features`, { query: featureQuery(filters) }),
    enabled: projectId > 0,
    placeholderData: (previous) => previous,
  })
}

export function useFeature(id: number) {
  return useQuery({
    queryKey: keys.feature(id),
    queryFn: () => api.get<Feature>(`/features/${id}`),
    enabled: id > 0,
  })
}

export function useProjectTags(projectId: number) {
  return useQuery({
    queryKey: keys.tags(projectId),
    queryFn: () => api.list<TagCount>(`/projects/${projectId}/tags`),
    enabled: projectId > 0,
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; description?: string; brief?: string }) =>
      api.post<Project>('/projects', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useUpdateProject(id: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<Pick<Project, 'name' | 'description' | 'brief'>>) =>
      api.patch<Project>(`/projects/${id}`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.project(id), updated)
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useCreateFeature(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<Feature>(`/projects/${projectId}/features`, body),
    onSuccess: () => {
      // The project's stats change too, so both lists are refreshed.
      queryClient.invalidateQueries({ queryKey: ['features', projectId] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: keys.project(projectId) })
      queryClient.invalidateQueries({ queryKey: keys.tags(projectId) })
    },
  })
}

export function useUpdateFeature(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      api.patch<Feature>(`/features/${id}`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.feature(updated.id), updated)
      queryClient.invalidateQueries({ queryKey: ['features', projectId] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: keys.project(projectId) })
    },
  })
}

export function useDeleteFeature(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.del(`/features/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['features', projectId] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: keys.project(projectId) })
    },
  })
}

export function useReplaceTags(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, tags }: { id: number; tags: string[] }) =>
      api.request_put<string[]>(`/features/${id}/tags`, { tags }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: keys.feature(id) })
      queryClient.invalidateQueries({ queryKey: ['features', projectId] })
      queryClient.invalidateQueries({ queryKey: keys.tags(projectId) })
    },
  })
}
