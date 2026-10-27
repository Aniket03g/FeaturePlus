/** Types mirroring the DTOs the Go API returns. */

export interface User {
  id: number
  username: string
  email: string
  name: string
  role: string
}

export interface ProjectStats {
  feature_count: number
  completed_features: number
  task_count: number
  completed_tasks: number
}

export interface Project {
  id: number
  name: string
  description: string
  brief: string
  owner_id: number
  owner?: User
  config: Record<string, unknown>
  stats?: ProjectStats
  /** The signed-in person's role in this project. */
  my_role?: ProjectRole
  created_at: string
  updated_at: string
}

/**
 * What someone may do in a project: owner shares and deletes, editor changes,
 * viewer looks. Admin is someone running the server, with the owner's powers
 * in a project that is not theirs.
 */
export type ProjectRole = 'owner' | 'editor' | 'viewer' | 'admin'

export const ROLE_LABEL: Record<ProjectRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
  admin: 'Admin',
}

/** Owner or admin: can share, transfer, delete and link GitHub. */
export function canManage(role: ProjectRole | undefined) {
  return role === 'owner' || role === 'admin'
}

/** One person a project is shared with. The owner is listed too, first. */
export interface ProjectMember {
  user: User
  role: ProjectRole
  added_at?: string
}

export interface Session {
  user: User
  token: string
}

export interface FeatureTaskCounts {
  total: number
  completed: number
}

export type FeatureStatus = 'todo' | 'in_progress' | 'done'
export type FeaturePriority = 'low' | 'medium' | 'high'

export interface Feature {
  id: number
  project_id: number
  parent_feature_id: number | null
  release_id: number | null
  title: string
  description: string
  /** Working notes beside the description, in markdown like it. */
  notes: string
  category: string
  status: FeatureStatus
  priority: FeaturePriority
  assignee_id: number
  /** Order among the features with the same parent, 1 first; 0 is an older feature, ordered by id. */
  position: number
  tags: string[]
  tasks?: FeatureTaskCounts
  sub_features?: Feature[]
  created_at: string
  updated_at: string
}

export interface TagCount {
  name: string
  count: number
}

/** The labels and tones used wherever a status or priority is displayed. */
export const STATUS_LABEL: Record<FeatureStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
}

export const PRIORITY_LABEL: Record<FeaturePriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export interface Approval {
  id: number
  user_id: number
  user?: User
  approved_at: string
  version?: string
}

/**
 * A pull request. The context fields are filled in only on the project-wide
 * list and the detail response — the copy embedded in a task leaves them out,
 * because the task around it already says what it belongs to.
 */
export interface PullRequest {
  id: number
  task_id: number
  feature_id: number
  url: string
  title: string
  branch: string
  description?: string
  status: string
  tested: boolean
  /** Derived from status, which is stored with inconsistent casing. */
  approved: boolean
  version?: string

  task_name?: string
  feature_title?: string
  project_id?: number
  approvals?: Approval[]

  created_at?: string
  updated_at?: string
}

/** The review decisions the API accepts, and how each one reads. */
export const REVIEW_LABEL: Record<string, string> = {
  approved: 'Approve',
  changes_requested: 'Request changes',
  rejected: 'Reject',
  open: 'Reopen',
}

/**
 * Reduce a stored status to the key the API filters on: the row saying
 * "Changes requested" is matched by ?status=changes_requested.
 */
export function statusKey(status: string) {
  return status.trim().toLowerCase().replace(/\s+/g, '_')
}

/**
 * The model declares three statuses, but the older Git finalize flow also
 * writes "in_progress", and rows holding it are live. Every lookup on this
 * falls back to the raw value, so a fourth one appearing does not blank out a
 * screen.
 */
export type ReleaseStatus = 'draft' | 'published' | 'failed' | 'in_progress'

export interface ReleaseCounts {
  total: number
  done: number
}

/** Why a release cannot go out yet, or what to know before it does. The sentences come from the API. */
export interface ReleaseReadiness {
  ready: boolean
  blockers: string[]
  /** Do not stop a publish; the screen asks before going ahead over them. */
  warnings?: string[]
}

export interface Release {
  id: number
  project_id: number
  tag: string
  status: ReleaseStatus
  notes: string
  features: ReleaseCounts
  pull_requests: ReleaseCounts

  /** The three below are present on a detail response only. */
  planned_features?: Feature[]
  linked_pull_requests?: PullRequest[]
  readiness?: ReleaseReadiness

  /** The GitHub Release made when this was published, in a project linked to GitHub. */
  github_url?: string
  /** Set instead of github_url when publishing to GitHub failed. The release is still published. */
  github_error?: string

  created_at: string
  updated_at: string
}

export const RELEASE_STATUS_LABEL: Record<ReleaseStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  failed: 'Failed',
  in_progress: 'In progress',
}

/** A source file mapped to a feature. */
export interface FeatureFile {
  id: number
  feature_id: number
  file_path: string
  created_at: string
}

/** A git commit mapped to a feature. */
export interface FeatureCommit {
  id: number
  feature_id: number
  commit_hash: string
  created_at: string
}

export type AccessLevel = 'owner' | 'contract' | 'none'

export const ACCESS_LABEL: Record<AccessLevel, string> = {
  owner: 'Full source',
  contract: 'Contract only',
  none: 'No access',
}

/** One collaborator's access grant on a feature. */
export interface Scope {
  id: number
  feature_id: number
  project_id: number
  user_id: number
  user?: User
  access_level: AccessLevel
  granted_by_id: number
  created_at: string
}

/**
 * A file as the caller is allowed to see it. `is_source` says whether this is
 * the real implementation or a stripped contract, so a screen never has to
 * guess what it is showing.
 */
export interface FileContent {
  file_path: string
  access: AccessLevel
  is_source: boolean
  content: string
  note?: string
  commit?: string
  /** The contract has drifted from the current source. */
  stale: boolean
}

export interface MockFile {
  file_path: string
  mock_filename: string
  content: string
}

export interface ContractArtifact {
  id: number
  project_id: number
  feature_id: number
  file_path: string
  commit_hash: string
  language: string
  behavior_note?: string
  updated_at: string
}

export interface Attachment {
  id: number
  task_id: number
  file_name: string
  file_size: number
  mime_type: string
  created_at: string
}

/** A file attached to a feature. A description links to it as `attachment:` and its name. */
export interface FeatureAttachment {
  id: number
  feature_id: number
  name: string
  file_size: number
  mime_type: string
  created_at: string
}

export interface TemplateSummary {
  id: string
  name: string
  stack: string
  tech_stack: string
  description: string
  feature_count: number
  task_count: number
  categories: string[]
  task_types: string[]
}

export interface Template extends TemplateSummary {
  features: { name: string; category: string; description: string }[]
  tasks: { name: string; type: string; description: string; priority: string }[]
  dependencies: string[]
  setup_steps: string[]
  environment_variables: string[]
  starter_repo?: string
  docs_links: string[]
}

export interface ApplyTemplateResult {
  template_id: string
  template_name: string
  features_created: number
  tasks_created: number
  features_skipped: number
  project_id: number
  config_updated: boolean
  skipped_because?: string
}

export interface ImportSummary {
  id: string
  name: string
  tech_stack?: string
  feature_count: number
  task_count: number
}

export interface ImportResult {
  project_id: number
  name: string
  features_created: number
  tasks_created: number
  source: string
}

/**
 * The scoped onboarding bundle: what a collaborator needs to build their
 * feature, assembled from their access grants. The shape comes straight from
 * the Go service, which is why it is nested rather than flat.
 */
export interface Briefing {
  project: { id: number; name: string; brief?: string; tech_stack?: string }
  your_features: {
    id: number
    title: string
    description?: string
    status?: string
    tasks: { id: number; task_name: string; task_type?: string; description?: string }[]
  }[]
  dependencies: {
    feature_id: number
    title: string
    description?: string
    files: {
      file_path: string
      contract?: string
      note?: string
      mock_filename?: string
      mock?: string
      stale?: boolean
    }[]
  }[]
  rules: string
}

/** Format a byte count for display. */
export function fileSize(bytes: number) {
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

export interface Comment {
  id: number
  task_id: number
  attachment_id?: number
  content: string
  author?: User
  created_at: string
  updated_at: string
}

export interface Task {
  id: number
  feature_id: number
  task_name: string
  task_type: string
  description: string
  /** Derived, not stored: true once a pull request is tested and approved. */
  done: boolean
  comment_count: number
  pull_requests: PullRequest[]
  comments?: Comment[]
  created_at: string
  updated_at: string
}

export interface GraphNode {
  id: number
  title: string
  status: FeatureStatus
  priority: FeaturePriority
  category: string
  tags: string[]
  /** Longest path leading into this node; the canvas lays out columns by it. */
  depth: number
  /**
   * The feature this one is part of, or null at the top level. Hierarchy is a
   * different relationship from dependency: the canvas draws it as a boundary
   * around the children, not as an arrow.
   */
  parent_id: number | null
}

export interface GraphEdge {
  id: number
  parent_id: number
  child_id: number
  description?: string
  in_cycle: boolean
}

export interface GraphCycle {
  node_ids: number[]
  edge_ids: number[]
}

export interface DependencyGraph {
  project_id: number
  nodes: GraphNode[]
  edges: GraphEdge[]
  cycles: GraphCycle[]
}

export interface Dependency {
  id: number
  parent_id: number
  child_id: number
  description?: string
  creates_cycle: boolean
}

/** What happened to one playground row on import, or would on a dry run. */
export interface PlaygroundOutcome {
  key: string
  title: string
  outcome: 'created' | 'existing' | 'updated'
  /** 0 for a row a dry run would create. */
  feature_id: number
}

export interface PlaygroundImportResult {
  project_id: number
  dry_run: boolean
  created: number
  existing: number
  /** Features the list was opened from that it renamed or moved. */
  updated: number
  items: PlaygroundOutcome[]
  releases_created: number
  releases_existing: number
  /** Features planned into a release. */
  planned: number
  /** Releases left alone because they are already published. */
  skipped_releases: string[]
  dependencies_created: number
  dependencies_existing: number
}

/** The AI's answer to a playground prompt: the whole revised list. */
export interface PlaygroundDraftResult {
  /** What wrote it. "stand-in" until a model is connected. */
  drafter: string
  /** A suggested name for the list; empty to keep the one it has. */
  title: string
  message: string
  features: { key: string; title: string; parent_key: string; needs: string[] }[]
}

/** Where the plan file is written in a linked repository. */
export const PLAN_FILE = '.featureplus/plan.md'

/** A project's link to the GitHub repository its plan is copied into. */
export interface GitHubLink {
  linked: boolean
  /** Whether the server has its GitHub App settings; without them no one can connect. */
  app_configured: boolean
  owner?: string
  repo?: string
  branch?: string
  repo_url?: string
  plan_url?: string
  last_synced_at?: string
  last_commit_sha?: string
}

/** The signed-in person's own connection to GitHub. */
export interface GitHubAccount {
  app_configured: boolean
  connected: boolean
  /** Their GitHub username. */
  login?: string
  /** Where they choose which repositories FeaturePlus may use. */
  manage_url?: string
}

/** A repository the person chose for FeaturePlus on GitHub. */
export interface GitHubRepo {
  full_name: string
  default_branch: string
  url: string
  can_push: boolean
}

export interface GitHubSyncResult {
  /** False when the file on GitHub already matched and nothing was committed. */
  changed: boolean
  commit_sha?: string
  link: GitHubLink
}
