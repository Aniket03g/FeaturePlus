import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from './api'
import type { AiRow, OpenedProject } from './playground'
import type {
  AccessLevel,
  ApplyTemplateResult,
  Attachment,
  Briefing,
  Comment,
  ContractArtifact,
  Dependency,
  DependencyGraph,
  Feature,
  FeatureCommit,
  FeatureFile,
  FileContent,
  ImportResult,
  ImportSummary,
  MockFile,
  PlaygroundDraftResult,
  PlaygroundImportResult,
  GitHubAccount,
  GitHubLink,
  GitHubRepo,
  GitHubSyncResult,
  Project,
  ProjectMember,
  ProjectRole,
  PullRequest,
  Release,
  ReleaseStatus,
  Scope,
  TagCount,
  Task,
  Template,
  TemplateSummary,
  User,
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

// ---------- sharing ----------

const memberKeys = {
  project: (projectId: number) => ['members', projectId] as const,
}

export function useMembers(projectId: number) {
  return useQuery({
    queryKey: memberKeys.project(projectId),
    queryFn: () => api.list<ProjectMember>(`/projects/${projectId}/members`),
    enabled: projectId > 0,
  })
}

export function useAddMember(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { email: string; role: ProjectRole }) =>
      api.post<ProjectMember>(`/projects/${projectId}/members`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: memberKeys.project(projectId) }),
  })
}

export function useUpdateMember(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: ProjectRole }) =>
      api.patch<ProjectMember>(`/projects/${projectId}/members/${userId}`, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: memberKeys.project(projectId) }),
  })
}

/** Hands the project to someone else; the old owner stays on as an editor. */
export function useTransferProject(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (email: string) => api.post<ProjectMember>(`/projects/${projectId}/transfer`, { email }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memberKeys.project(projectId) })
      queryClient.invalidateQueries({ queryKey: keys.project(projectId) })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

/** Removes someone, or, with your own id, leaves the project. */
export function useRemoveMember(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: number) => api.del(`/projects/${projectId}/members/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memberKeys.project(projectId) })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useCreateFeature(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<Feature>(`/projects/${projectId}/features`, body),
    onSuccess: (_created, body) => {
      // A parent's page lists its sub-features, so it is refreshed too.
      if (typeof body.parent_feature_id === 'number') {
        queryClient.invalidateQueries({ queryKey: keys.feature(body.parent_feature_id) })
      }
      // The project's stats change too, so both lists are refreshed.
      queryClient.invalidateQueries({ queryKey: ['features', projectId] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: keys.project(projectId) })
      queryClient.invalidateQueries({ queryKey: keys.tags(projectId) })
      // The dependency canvas draws from its own query, not the feature list.
      queryClient.invalidateQueries({ queryKey: graphKeys.graph(projectId) })
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
      queryClient.invalidateQueries({ queryKey: graphKeys.graph(projectId) })
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
      queryClient.invalidateQueries({ queryKey: graphKeys.graph(projectId) })
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

export const releaseKeys = {
  releases: (projectId: number, params?: unknown) =>
    ['releases', projectId, params ?? {}] as const,
  release: (id: number) => ['release', id] as const,
}

export interface ReleaseFilters {
  status?: ReleaseStatus[]
  q?: string
}

export function useReleases(projectId: number, filters: ReleaseFilters = {}) {
  return useQuery({
    queryKey: releaseKeys.releases(projectId, filters),
    queryFn: () =>
      api.list<Release>(`/projects/${projectId}/releases`, {
        query: {
          status: filters.status?.length ? filters.status.join(',') : undefined,
          q: filters.q || undefined,
          per_page: 200,
        },
      }),
    enabled: projectId > 0,
    placeholderData: (previous) => previous,
  })
}

export function useRelease(id: number) {
  return useQuery({
    queryKey: releaseKeys.release(id),
    queryFn: () => api.get<Release>(`/releases/${id}`),
    enabled: id > 0,
  })
}

/**
 * Every release write touches the same three things: the release itself, the
 * project's release list, and — because planning moves features in and out of
 * a release — the project's feature list.
 */
function invalidateRelease(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: number,
  releaseId?: number,
) {
  if (releaseId) queryClient.invalidateQueries({ queryKey: releaseKeys.release(releaseId) })
  queryClient.invalidateQueries({ queryKey: ['releases', projectId] })
  queryClient.invalidateQueries({ queryKey: ['features', projectId] })
}

export function useCreateRelease(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { tag: string; notes?: string; feature_ids?: number[] }) =>
      api.post<Release>(`/projects/${projectId}/releases`, body),
    onSuccess: () => invalidateRelease(queryClient, projectId),
  })
}

export function useUpdateRelease(projectId: number, releaseId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { tag?: string; notes?: string }) =>
      api.patch<Release>(`/releases/${releaseId}`, body),
    onSuccess: () => invalidateRelease(queryClient, projectId, releaseId),
  })
}

export function useDeleteRelease(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (releaseId: number) => api.del(`/releases/${releaseId}`),
    onSuccess: () => invalidateRelease(queryClient, projectId),
  })
}

export function usePublishRelease(projectId: number, releaseId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<Release>(`/releases/${releaseId}/publish`),
    onSuccess: () => {
      invalidateRelease(queryClient, projectId, releaseId)
      queryClient.invalidateQueries({ queryKey: githubKeys.link(projectId) })
    },
  })
}

export function useAssignFeatures(projectId: number, releaseId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (featureIds: number[]) =>
      api.post<Release>(`/releases/${releaseId}/features`, { feature_ids: featureIds }),
    onSuccess: (updated) => {
      queryClient.setQueryData(releaseKeys.release(releaseId), updated)
      invalidateRelease(queryClient, projectId)
    },
  })
}

export function useUnassignFeature(projectId: number, releaseId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (featureId: number) => api.del(`/releases/${releaseId}/features/${featureId}`),
    onSuccess: () => invalidateRelease(queryClient, projectId, releaseId),
  })
}

export function useLinkPullRequests(projectId: number, releaseId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (pullRequestIds: number[]) =>
      api.post<Release>(`/releases/${releaseId}/pull-requests`, {
        pull_request_ids: pullRequestIds,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(releaseKeys.release(releaseId), updated)
      invalidateRelease(queryClient, projectId)
    },
  })
}

export function useUnlinkPullRequest(projectId: number, releaseId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (pullRequestId: number) =>
      api.del(`/releases/${releaseId}/pull-requests/${pullRequestId}`),
    onSuccess: () => {
      invalidateRelease(queryClient, projectId, releaseId)
      queryClient.invalidateQueries({ queryKey: ['pull-requests', projectId] })
    },
  })
}

export const prKeys = {
  pullRequests: (projectId: number, params?: unknown) =>
    ['pull-requests', projectId, params ?? {}] as const,
  pullRequest: (id: number) => ['pull-request', id] as const,
}

export interface PullRequestFilters {
  status?: string[]
  tested?: 'true' | 'false' | ''
  q?: string
}

export function usePullRequests(projectId: number, filters: PullRequestFilters = {}) {
  return useQuery({
    queryKey: prKeys.pullRequests(projectId, filters),
    queryFn: () =>
      api.list<PullRequest>(`/projects/${projectId}/pull-requests`, {
        query: {
          status: filters.status?.length ? filters.status.join(',') : undefined,
          tested: filters.tested || undefined,
          q: filters.q || undefined,
          per_page: 200,
        },
      }),
    enabled: projectId > 0,
    placeholderData: (previous) => previous,
  })
}

export function usePullRequest(id: number) {
  return useQuery({
    queryKey: prKeys.pullRequest(id),
    queryFn: () => api.get<PullRequest>(`/pull-requests/${id}`),
    enabled: id > 0,
  })
}

/**
 * A pull request write can change whether its task is complete, which changes
 * the feature and project counts above it, and whether a release holding it is
 * ready to publish. Rather than work out which of those applies to a given
 * write, every one of them refreshes the lot.
 */
function invalidatePullRequest(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: number,
  pullRequestId?: number,
) {
  if (pullRequestId) {
    queryClient.invalidateQueries({ queryKey: prKeys.pullRequest(pullRequestId) })
  }
  queryClient.invalidateQueries({ queryKey: ['pull-requests', projectId] })
  queryClient.invalidateQueries({ queryKey: ['releases', projectId] })
  queryClient.invalidateQueries({ queryKey: ['release'] })
  queryClient.invalidateQueries({ queryKey: ['tasks'] })
  queryClient.invalidateQueries({ queryKey: ['task'] })
  queryClient.invalidateQueries({ queryKey: ['features', projectId] })
  queryClient.invalidateQueries({ queryKey: keys.project(projectId) })
  queryClient.invalidateQueries({ queryKey: ['projects'] })
}

export function useCreatePullRequest(projectId: number, taskId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      title: string
      url: string
      branch: string
      description?: string
      version?: string
    }) => api.post<PullRequest>(`/tasks/${taskId}/pull-requests`, body),
    onSuccess: () => invalidatePullRequest(queryClient, projectId),
  })
}

export function useUpdatePullRequest(projectId: number, pullRequestId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<PullRequest>(`/pull-requests/${pullRequestId}`, body),
    onSuccess: () => invalidatePullRequest(queryClient, projectId, pullRequestId),
  })
}

export function useDeletePullRequest(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (pullRequestId: number) => api.del(`/pull-requests/${pullRequestId}`),
    onSuccess: () => invalidatePullRequest(queryClient, projectId),
  })
}

export function useReviewPullRequest(projectId: number, pullRequestId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { status: string; comment?: string }) =>
      api.post<PullRequest>(`/pull-requests/${pullRequestId}/review`, body),
    onSuccess: () => invalidatePullRequest(queryClient, projectId, pullRequestId),
  })
}

export function useMarkTested(projectId: number, pullRequestId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tested: boolean) =>
      api.post<PullRequest>(`/pull-requests/${pullRequestId}/tested`, { tested }),
    onSuccess: () => invalidatePullRequest(queryClient, projectId, pullRequestId),
  })
}

export const teamKeys = {
  users: (params?: unknown) => ['users', params ?? {}] as const,
  user: (id: number) => ['user', id] as const,
}

export function useUsers(params: { q?: string; role?: string[] } = {}) {
  return useQuery({
    queryKey: teamKeys.users(params),
    queryFn: () =>
      api.list<User>('/users', {
        query: {
          q: params.q || undefined,
          role: params.role?.length ? params.role.join(',') : undefined,
          per_page: 200,
        },
      }),
    placeholderData: (previous) => previous,
  })
}

export function useUpdateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      api.patch<User>(`/users/${id}`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(teamKeys.user(updated.id), updated)
      queryClient.invalidateQueries({ queryKey: ['users'] })
      // The signed-in user may be the one that changed, and the shell shows
      // their name and role.
      queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

/** An admin setting a new password for someone who forgot theirs. */
export function useResetUserPassword() {
  return useMutation({
    mutationFn: ({ id, newPassword }: { id: number; newPassword: string }) =>
      api.post(`/users/${id}/password`, { new_password: newPassword }),
  })
}

export function useDeleteUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.del(`/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })
}

export const codeKeys = {
  files: (featureId: number) => ['feature-files', featureId] as const,
  commits: (featureId: number) => ['feature-commits', featureId] as const,
  projectFiles: (projectId: number, params?: unknown) =>
    ['project-files', projectId, params ?? {}] as const,
}

export function useFeatureFiles(featureId: number) {
  return useQuery({
    queryKey: codeKeys.files(featureId),
    queryFn: () => api.list<FeatureFile>(`/features/${featureId}/files`),
    enabled: featureId > 0,
  })
}

export function useFeatureCommits(featureId: number) {
  return useQuery({
    queryKey: codeKeys.commits(featureId),
    queryFn: () => api.list<FeatureCommit>(`/features/${featureId}/commits`),
    enabled: featureId > 0,
  })
}

export function useProjectFiles(projectId: number, q = '') {
  return useQuery({
    queryKey: codeKeys.projectFiles(projectId, { q }),
    queryFn: () =>
      api.list<FeatureFile>(`/projects/${projectId}/files`, {
        query: { q: q || undefined, per_page: 200 },
      }),
    enabled: projectId > 0,
    placeholderData: (previous) => previous,
  })
}

/**
 * Mapping code changes what a briefing contains and what a contract can be
 * extracted from, so a write refreshes the project's whole code view rather
 * than only the feature that changed.
 */
function invalidateCode(
  queryClient: ReturnType<typeof useQueryClient>,
  featureId: number,
  projectId: number,
) {
  queryClient.invalidateQueries({ queryKey: codeKeys.files(featureId) })
  queryClient.invalidateQueries({ queryKey: codeKeys.commits(featureId) })
  queryClient.invalidateQueries({ queryKey: ['project-files', projectId] })
  queryClient.invalidateQueries({ queryKey: ['briefing', projectId] })
}

export function useLinkFile(featureId: number, projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (filePath: string) =>
      api.post<FeatureFile>(`/features/${featureId}/files`, { file_path: filePath }),
    onSuccess: () => invalidateCode(queryClient, featureId, projectId),
  })
}

export function useUnlinkFile(featureId: number, projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (fileId: number) => api.del(`/features/${featureId}/files/${fileId}`),
    onSuccess: () => invalidateCode(queryClient, featureId, projectId),
  })
}

export function useLinkCommit(featureId: number, projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commitHash: string) =>
      api.post<FeatureCommit>(`/features/${featureId}/commits`, { commit_hash: commitHash }),
    onSuccess: () => invalidateCode(queryClient, featureId, projectId),
  })
}

export function useUnlinkCommit(featureId: number, projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commitId: number) => api.del(`/features/${featureId}/commits/${commitId}`),
    onSuccess: () => invalidateCode(queryClient, featureId, projectId),
  })
}

export const scopeKeys = {
  feature: (featureId: number) => ['scopes', featureId] as const,
  project: (projectId: number) => ['project-scopes', projectId] as const,
}

export function useFeatureScopes(featureId: number) {
  return useQuery({
    queryKey: scopeKeys.feature(featureId),
    queryFn: () => api.list<Scope>(`/features/${featureId}/scopes`),
    enabled: featureId > 0,
  })
}

export function useProjectScopes(projectId: number) {
  return useQuery({
    queryKey: scopeKeys.project(projectId),
    queryFn: () => api.list<Scope>(`/projects/${projectId}/scopes`, { query: { per_page: 200 } }),
    enabled: projectId > 0,
  })
}

export function useGrantScope(featureId: number, projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { user_id: number; access_level: AccessLevel }) =>
      api.post<Scope>(`/features/${featureId}/scopes`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scopeKeys.feature(featureId) })
      queryClient.invalidateQueries({ queryKey: scopeKeys.project(projectId) })
    },
  })
}

export function useRevokeScope(featureId: number, projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (scopeId: number) => api.del(`/features/${featureId}/scopes/${scopeId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scopeKeys.feature(featureId) })
      queryClient.invalidateQueries({ queryKey: scopeKeys.project(projectId) })
    },
  })
}

export const contractKeys = {
  contracts: (projectId: number, params?: unknown) =>
    ['contracts', projectId, params ?? {}] as const,
  source: (projectId: number, path: string) => ['source', projectId, path] as const,
  mock: (projectId: number, path: string) => ['mock', projectId, path] as const,
  briefing: (projectId: number) => ['briefing', projectId] as const,
}

export function useContracts(projectId: number, path = '') {
  return useQuery({
    queryKey: contractKeys.contracts(projectId, { path }),
    queryFn: () =>
      api.list<ContractArtifact>(`/projects/${projectId}/contracts`, {
        query: { path: path || undefined, per_page: 200 },
      }),
    enabled: projectId > 0,
    placeholderData: (previous) => previous,
  })
}

export function useFileContent(projectId: number, path: string) {
  return useQuery({
    queryKey: contractKeys.source(projectId, path),
    queryFn: () => api.get<FileContent>(`/projects/${projectId}/source`, { query: { path } }),
    enabled: projectId > 0 && path !== '',
    // A file that cannot be read is a fact about the setup, not a blip; asking
    // again three times only slows down showing the message.
    retry: false,
  })
}

export function useMock(projectId: number, path: string, enabled: boolean) {
  return useQuery({
    queryKey: contractKeys.mock(projectId, path),
    queryFn: () => api.get<MockFile>(`/projects/${projectId}/mock`, { query: { path } }),
    enabled: enabled && projectId > 0 && path !== '',
    retry: false,
  })
}

export function useBriefing(projectId: number) {
  return useQuery({
    queryKey: contractKeys.briefing(projectId),
    queryFn: () => api.get<Briefing>(`/projects/${projectId}/briefing`),
    enabled: projectId > 0,
    // 404 here means "you hold no grant in this project", which is an answer
    // rather than a failure to retry.
    retry: false,
  })
}

export const attachmentKeys = {
  list: (taskId: number) => ['attachments', taskId] as const,
}

export function useAttachments(taskId: number) {
  return useQuery({
    queryKey: attachmentKeys.list(taskId),
    queryFn: () => api.list<Attachment>(`/tasks/${taskId}/attachments`),
    enabled: taskId > 0,
  })
}

export function useUploadAttachment(taskId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => api.upload<Attachment>(`/tasks/${taskId}/attachments`, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: attachmentKeys.list(taskId) }),
  })
}

export function useDeleteAttachment(taskId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.del(`/attachments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: attachmentKeys.list(taskId) })
      // A comment may have pointed at the file; the API detaches it.
      queryClient.invalidateQueries({ queryKey: ['comments', taskId] })
    },
  })
}

export const templateKeys = {
  templates: (params?: unknown) => ['templates', params ?? {}] as const,
  template: (id: string) => ['template', id] as const,
  imports: () => ['imports'] as const,
}

export function useTemplates(params: { q?: string; stack?: string } = {}) {
  return useQuery({
    queryKey: templateKeys.templates(params),
    queryFn: () =>
      api.list<TemplateSummary>('/templates', {
        query: { q: params.q || undefined, stack: params.stack || undefined, per_page: 200 },
      }),
    placeholderData: (previous) => previous,
  })
}

export function useTemplate(id: string) {
  return useQuery({
    queryKey: templateKeys.template(id),
    queryFn: () => api.get<Template>(`/templates/${encodeURIComponent(id)}`),
    enabled: id !== '',
  })
}

export function useApplyTemplate(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (templateId: string) =>
      api.post<ApplyTemplateResult>(`/projects/${projectId}/template`, { template_id: templateId }),
    onSuccess: () => {
      // A template writes features and tasks, and rewrites the project's own
      // categories and task types, so everything about the project is stale.
      queryClient.invalidateQueries({ queryKey: ['features', projectId] })
      queryClient.invalidateQueries({ queryKey: keys.project(projectId) })
      queryClient.invalidateQueries({ queryKey: keys.tags(projectId) })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useImports() {
  return useQuery({
    queryKey: templateKeys.imports(),
    queryFn: () => api.list<ImportSummary>('/imports', { query: { per_page: 200 } }),
  })
}

export function useImportProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { import_id: string; name?: string; description?: string }) =>
      api.post<ImportResult>('/imports/project', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export function useImportFromGitHub() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { repo_url: string; name?: string }) =>
      api.post<ImportResult>('/imports/github', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: templateKeys.imports() })
    },
  })
}

export function useDeleteImport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.del(`/imports/${encodeURIComponent(id)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: templateKeys.imports() }),
  })
}

// ---------- playground ----------

export interface PlaygroundImportBody {
  project_id?: number
  new_project?: { name: string; description?: string }
  features: {
    key: string
    title: string
    parent_key: string
    release_key?: string
    needs?: string[]
    feature_id?: number
    moved?: boolean
  }[]
  /** In shipping order; new ones are created in this order. */
  releases?: { key: string; name: string }[]
  dry_run?: boolean
}

/**
 * What an import would do, without doing it: which names the project already
 * has. Keyed on the rows themselves, so it refreshes as the list is edited.
 */
export function usePlaygroundPreview(body: PlaygroundImportBody | null) {
  return useQuery({
    queryKey: ['playground-preview', body],
    queryFn: () => api.post<PlaygroundImportResult>('/playground/import', { ...body, dry_run: true }),
    enabled: body !== null && body.features.length > 0,
    placeholderData: (previous) => previous,
    retry: false,
  })
}

/** Which AI answers prompts: Claude once a key is set on the server, a stand-in until then. */
export function usePlaygroundAi() {
  return useQuery({
    queryKey: ['playground-ai'],
    queryFn: () => api.get<{ drafter: string; connected: boolean }>('/playground/ai'),
    staleTime: Infinity,
  })
}

/** The person's saved playground, as the page last sent it; null when there is none. */
export function fetchSavedPlayground() {
  return api.get<{ draft: unknown; updated_at?: string }>('/playground/saved')
}

export function savePlayground(draft: unknown) {
  return api.request_put<{ updated_at: string }>('/playground/saved', draft)
}

/** A project as a playground list: features, nesting, dependencies and releases. */
export function fetchProjectForPlayground(projectId: number) {
  return api.get<OpenedProject>(`/playground/projects/${projectId}`)
}

/**
 * Ask the AI for a revised list. Nothing is written: the answer replaces the
 * playground's draft, where it is looked over like any other list.
 */
export function usePlaygroundDraft() {
  return useMutation({
    mutationFn: (body: { prompt: string; features: AiRow[] }) =>
      api.post<PlaygroundDraftResult>('/playground/draft', body),
  })
}

export function usePlaygroundImport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: PlaygroundImportBody) =>
      api.post<PlaygroundImportResult>('/playground/import', body),
    onSuccess: (result) => {
      const id = result.project_id
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: keys.project(id) })
      queryClient.invalidateQueries({ queryKey: ['features', id] })
      queryClient.invalidateQueries({ queryKey: graphKeys.graph(id) })
      queryClient.invalidateQueries({ queryKey: ['playground-preview'] })
      queryClient.invalidateQueries({ queryKey: ['releases', id] })
      queryClient.invalidateQueries({ queryKey: githubKeys.link(id) })
    },
  })
}

// ---------- GitHub ----------

export const githubKeys = {
  link: (projectId: number) => ['github', projectId] as const,
  account: ['github-account'] as const,
  repos: ['github-repos'] as const,
}

/**
 * The address that starts connecting to GitHub. It is opened as a page, not
 * fetched: the server answers by sending the browser to GitHub, and GitHub
 * sends it back to `returnTo` with ?github= saying how it went. `install` goes
 * straight to choosing repositories.
 */
export function githubConnectUrl(returnTo: string, install = false) {
  const query = new URLSearchParams({ return_to: returnTo })
  if (install) query.set('step', 'install')
  return `/api/v1/github/connect?${query.toString()}`
}

export function useGitHubAccount() {
  return useQuery({
    queryKey: githubKeys.account,
    queryFn: () => api.get<GitHubAccount>('/github/account'),
  })
}

export function useGitHubRepos(enabled: boolean) {
  return useQuery({
    queryKey: githubKeys.repos,
    queryFn: () => api.get<GitHubRepo[]>('/github/repos'),
    enabled,
    retry: false,
  })
}

export function useDisconnectGitHub() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.del('/github/account'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: githubKeys.account })
      queryClient.removeQueries({ queryKey: githubKeys.repos })
    },
  })
}

export function useGitHubLink(projectId: number) {
  return useQuery({
    queryKey: githubKeys.link(projectId),
    queryFn: () => api.get<GitHubLink>(`/projects/${projectId}/github`),
    enabled: projectId > 0,
  })
}

export function useLinkGitHub(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { repo: string; branch?: string }) =>
      api.request_put<GitHubLink>(`/projects/${projectId}/github`, body),
    onSuccess: (link) => queryClient.setQueryData(githubKeys.link(projectId), link),
  })
}

export function useUnlinkGitHub(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.del(`/projects/${projectId}/github`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: githubKeys.link(projectId) }),
  })
}

export function useSyncGitHub(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<GitHubSyncResult>(`/projects/${projectId}/github/sync`),
    onSuccess: (result) => queryClient.setQueryData(githubKeys.link(projectId), result.link),
  })
}

/** Make the GitHub Release for an already published release: the retry after a failure. */
export function usePublishReleaseToGitHub(projectId: number, releaseId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ github_url: string }>(`/releases/${releaseId}/github`),
    onSuccess: () => {
      invalidateRelease(queryClient, projectId, releaseId)
      queryClient.invalidateQueries({ queryKey: githubKeys.link(projectId) })
    },
  })
}
