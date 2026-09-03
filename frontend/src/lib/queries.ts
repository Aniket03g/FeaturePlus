import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from './api'
import type {
  Comment,
  Dependency,
  DependencyGraph,
  Feature,
  Project,
  TagCount,
  Task,
} from './types'

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

export const taskKeys = {
  tasks: (featureId: number, params?: unknown) => ['tasks', featureId, params ?? {}] as const,
  task: (id: number) => ['task', id] as const,
  comments: (taskId: number) => ['comments', taskId] as const,
}

export interface TaskFilters {
  type?: string[]
  done?: 'true' | 'false' | ''
  q?: string
}

export function useTasks(featureId: number, filters: TaskFilters = {}) {
  return useQuery({
    queryKey: taskKeys.tasks(featureId, filters),
    queryFn: () =>
      api.list<Task>(`/features/${featureId}/tasks`, {
        query: {
          type: filters.type?.length ? filters.type.join(',') : undefined,
          done: filters.done || undefined,
          q: filters.q || undefined,
          per_page: 200,
        },
      }),
    enabled: featureId > 0,
    placeholderData: (previous) => previous,
  })
}

export function useTask(id: number) {
  return useQuery({
    queryKey: taskKeys.task(id),
    queryFn: () => api.get<Task>(`/tasks/${id}`),
    enabled: id > 0,
  })
}

/**
 * Task writes invalidate the feature and project caches too, because a task
 * changes the counts those screens display.
 */
function invalidateAround(
  queryClient: ReturnType<typeof useQueryClient>,
  featureId: number,
  projectId: number,
) {
  queryClient.invalidateQueries({ queryKey: ['tasks', featureId] })
  queryClient.invalidateQueries({ queryKey: keys.feature(featureId) })
  queryClient.invalidateQueries({ queryKey: ['features', projectId] })
  queryClient.invalidateQueries({ queryKey: keys.project(projectId) })
  queryClient.invalidateQueries({ queryKey: ['projects'] })
}

export function useCreateTask(featureId: number, projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { task_name: string; task_type?: string; description?: string }) =>
      api.post<Task>(`/features/${featureId}/tasks`, body),
    onSuccess: () => invalidateAround(queryClient, featureId, projectId),
  })
}

export function useUpdateTask(featureId: number, projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      api.patch<Task>(`/tasks/${id}`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(taskKeys.task(updated.id), updated)
      invalidateAround(queryClient, featureId, projectId)
    },
  })
}

export function useDeleteTask(featureId: number, projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.del(`/tasks/${id}`),
    onSuccess: () => invalidateAround(queryClient, featureId, projectId),
  })
}

export function useComments(taskId: number) {
  return useQuery({
    queryKey: taskKeys.comments(taskId),
    queryFn: () => api.list<Comment>(`/tasks/${taskId}/comments`),
    enabled: taskId > 0,
  })
}

export function useAddComment(taskId: number, featureId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (content: string) => api.post<Comment>(`/tasks/${taskId}/comments`, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.comments(taskId) })
      queryClient.invalidateQueries({ queryKey: taskKeys.task(taskId) })
      queryClient.invalidateQueries({ queryKey: ['tasks', featureId] })
    },
  })
}

export function useDeleteComment(taskId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.del(`/comments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.comments(taskId) })
      queryClient.invalidateQueries({ queryKey: taskKeys.task(taskId) })
    },
  })
}

export const graphKeys = {
  graph: (projectId: number) => ['dependency-graph', projectId] as const,
}

export function useDependencyGraph(projectId: number) {
  return useQuery({
    queryKey: graphKeys.graph(projectId),
    queryFn: () => api.get<DependencyGraph>(`/projects/${projectId}/dependency-graph`),
    enabled: projectId > 0,
  })
}

export function useCreateDependency(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { parent_id: number; child_id: number; description?: string }) =>
      api.post<Dependency>(`/projects/${projectId}/dependencies`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: graphKeys.graph(projectId) })
    },
  })
}

export function useDeleteDependency(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.del(`/dependencies/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: graphKeys.graph(projectId) })
    },
  })
}
