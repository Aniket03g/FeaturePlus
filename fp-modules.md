# FeaturePlus — Feature → Plan → Code Map (`fp-modules.md`)

This document maps **features / subfeatures** (up to 4 nesting levels) to a reusable
**plan** (the high-level intent used while building), and records the **concrete code
artifacts** that implement that plan. Source of truth = the actual code in this repo
(Go backend, React frontend, CLI, Python `tools/map`).

Use it two ways:
1. **Reverse map** — what was already built and where it lives.
2. **Forward template** — when adding a new feature, pick a plan verb, then fill column 3
   with the table/column, component, module, or function you will touch.

---

## Plan vocabulary (reusable intent verbs)

| Plan | Meaning | Column-3 should name |
|------|---------|----------------------|
| `ADD_DB_TABLE` | New persistent model / table | model file + table + key columns |
| `ADD_DB_COLUMN` | New column(s) on an existing table | table + column + type |
| `ADD_MIGRATION` | SQL migration for schema change | migration file |
| `ADD_MODULE` | New backend module (handler / service / repository) | package + file |
| `CHANGE_MODULE` | Modify an existing backend module | package + file |
| `ADD_FUNCTION` | New function / handler method | module path + func name |
| `CHANGE_FUNCTION` | Modify an existing function | module path + func name |
| `ADD_API_ENDPOINT` | New HTTP route | method + path + handler |
| `CHANGE_API_ENDPOINT` | Alter route behavior/shape | method + path + handler |
| `ADD_UI_COMPONENT` | New reusable React component | component file |
| `ADD_UI_PAGE` | New React page / route | page file |
| `CHANGE_UI_COMPONENT` | Modify existing React component/page | file + element/prop |
| `ADD_UI_CLIENT_FN` | New frontend lib/api/query helper | lib file + function |

> Feature column uses a dotted hierarchy: `Domain › Feature › Subfeature › UI/field detail`.

---

## 1. Authentication & Users

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| Auth › User identity | `ADD_DB_TABLE` | `backend/models/user.go` → `users` (email, username, password hash, role, name, space_seen_at) |
| Auth › Login › credential check | `ADD_FUNCTION` | `backend/handlers/auth_handler.go:Login`; JWT in `backend/middleware/auth.go` |
| Auth › Login › UI | `ADD_UI_PAGE` | `frontend/src/pages/Login.tsx`; client `frontend/src/lib/auth.tsx`, `lib/api.ts` |
| Auth › Signup › invite-code gated | `ADD_FUNCTION` | `auth_handler.go:Signup`; route `GET/POST /api/v1/auth/signup` |
| Auth › Invite codes › model | `ADD_DB_TABLE` | `backend/models/invite_code.go` → `invite_codes` (code_hash, hint, email, note, created_by_id) |
| Auth › Invite codes › issue/list UI | `ADD_UI_PAGE` | `frontend/src/pages/InviteCodes.tsx`; routes `GET /api/v1/invites` |
| Auth › Change password | `ADD_UI_COMPONENT` | `frontend/src/pages/ChangePasswordDialog.tsx`; `user_handler.go:UpdateUser` |
| Users › CRUD | `ADD_FUNCTION` | `user_handler.go:{GetAllUsers,GetUser,CreateUser,UpdateUser,DeleteUser}`; routes `/api/v1/users` |
| Users › Role-based access | `ADD_MODULE` | `backend/middleware/role.go`, `middleware/scope.go` |

## 2. Projects

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| Projects › Project entity | `ADD_DB_TABLE` | `backend/models/project.go` → `projects` (name, description, brief, owner_id, config JSONB) |
| Projects › CRUD API | `ADD_FUNCTION` | `handlers/project_handler.go:{GetAllProjects,GetProject,DeleteProject}`; repo `repositories/project_repository.go` |
| Projects › Create › modal + form | `ADD_UI_COMPONENT` | `frontend/src/pages/NewProjectDialog.tsx`; `project_handler.go:{ShowProjectCreateModal,CreateProjectFromForm}` |
| Projects › List page | `ADD_UI_PAGE` | `frontend/src/pages/Projects.tsx`; route `GET /api/v1/projects` |
| Projects › Dashboard | `ADD_UI_PAGE` | `frontend/src/pages/ProjectDashboard.tsx`, `ProjectDetail.tsx` |
| Projects › Progress stats | `ADD_FUNCTION` | `project_handler.go:{GetProjectProgress,getProjectProgressStats,GetFeaturesProgressFragment}` |
| Projects › Settings › model | `ADD_DB_TABLE` | `backend/models/project_settings.go` → `project_settings` (versions_convention, publish_convention, architecture, color_meanings, modules) |
| Projects › Settings › editor | `ADD_UI_PAGE` | `frontend/src/pages/ProjectSettings.tsx`; `project_handler.go:{GetProjectSettingsModal,UpdateProjectSettings}` |
| Projects › Members › model | `ADD_DB_TABLE` | `backend/models/project_member.go` → `project_members` (project_id, user_id, role, added_by) |
| Projects › Team page | `ADD_UI_PAGE` | `frontend/src/pages/ProjectTeam.tsx`, `Team.tsx`; route `GET /api/v1/projects/:id/members` |
| Projects › Messages › model | `ADD_DB_TABLE` | `backend/models/feature_message.go` (project+feature scoped) |
| Projects › Messages page | `ADD_UI_PAGE` | `frontend/src/pages/ProjectMessages.tsx`; route `GET /api/v1/projects/:id/messages` |
| Projects › Recent-visit tracking | `ADD_DB_TABLE` | `backend/models/project_visit.go` → `project_visits` |

## 3. Features & Sub-features

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| Features › Feature entity | `ADD_DB_TABLE` | `backend/models/features.go` → `features` (project_id, parent_feature_id, release_id, title, notes, category, status, priority, assignee_id, kind, position) |
| Features › Hierarchy (parent/child) | `ADD_DB_COLUMN` | `features.parent_feature_id *uint` + self FK `ParentFeature` |
| Features › Sub-feature entity | `ADD_DB_TABLE` | `backend/models/sub_feature.go` → `sub_features`; migration `migrations/000004_create_sub_features_table.up.sql` |
| Features › CRUD API | `ADD_FUNCTION` | `handlers/feature_handler.go:{CreateFeature,GetFeature,UpdateFeature,DeleteFeature}`; repo `feature_repository.go` |
| Features › Inline edit | `ADD_FUNCTION` | `feature_handler.go:{EditFeatureInline,UpdateFeatureInline,UpdateFeatureField}` |
| Features › Detail page | `ADD_UI_PAGE` | `frontend/src/pages/FeatureDetail.tsx`; `components/FeatureBits.tsx` |
| Features › Create dialog | `ADD_UI_COMPONENT` | `frontend/src/pages/NewFeatureDialog.tsx`; `feature_fragments.go:{NewFeatureForm,NewFeatureFragment}` |
| Features › Colour › field | `ADD_DB_COLUMN` | `features.color varchar(20)` |
| Features › Colour › picker UI | `ADD_UI_COMPONENT` | `frontend/src/components/FeatureColor.tsx`; meanings in `project_settings.color_meanings` |
| Features › Kind flag | `ADD_DB_COLUMN` | `features.kind varchar(10)` (feature vs other) |
| Features › Tags › model | `ADD_DB_TABLE` | `backend/models/tag.go` → `feature_tags` (tag_name, feature_id) |
| Features › Tags › edit/autocomplete | `ADD_FUNCTION` | `handlers/tags_handler.go:{UpdateFeatureTags,TagAutocomplete,GetFeatureTags,GetFeaturesByTag}` |
| Features › Messages thread | `ADD_UI_COMPONENT` | `frontend/src/components/FeatureMessages.tsx`; route `GET /api/v1/features/:featureId/messages` |
| Features › Scope / access › model | `ADD_DB_TABLE` | `backend/models/feature_scope.go` → `feature_scopes` (feature_id, user_id, access_level, granted_by_id) |
| Features › Scope › grant/revoke | `ADD_FUNCTION` | `feature_handler.go:{CreateFeatureScope,GetFeatureScopes,DeleteFeatureScope,renderScopes}`; service `services/access_service.go` |
| Features › Scope › access UI | `ADD_UI_COMPONENT` | `frontend/src/components/FeatureAccess.tsx` |
| Features › Assignment to release | `ADD_DB_COLUMN` | `features.release_id *uint`; `feature_handler.go:CreateFeatureUnderRelease` |

## 4. Tasks

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| Tasks › Task entity | `ADD_DB_TABLE` | `backend/models/task.go` → `tasks` (task_type, task_name, description, feature_id, sub_feature_id, created_by_user) |
| Tasks › CRUD (feature & sub-feature) | `ADD_FUNCTION` | `handlers/task_handler.go:{CreateTaskForFeature,CreateTaskForSubFeature,UpdateTaskForFeature,DeleteTaskForFeature,UpdateTaskInline}` |
| Tasks › List UI | `ADD_UI_COMPONENT` | `frontend/src/components/TaskList.tsx`; `pages/TaskPanel.tsx` |
| Tasks › Inline forms (fragments) | `ADD_FUNCTION` | `handlers/task_fragments.go:{NewTaskForm,EditTaskForm,CancelTaskForm,ViewTaskCard}` |
| Tasks › Comments › model | `ADD_DB_TABLE` | `backend/models/comment.go` → `comments` |
| Tasks › Comments › API | `ADD_FUNCTION` | `handlers/comment_handler.go:{CreateComment,UpdateComment,DeleteComment,GetTaskComments}` |
| Tasks › Attachments › model | `ADD_DB_TABLE` | `backend/models/task_attachment.go` → `task_attachments` |
| Tasks › Attachments › upload/serve | `ADD_FUNCTION` | `handlers/task_attachment_handler.go:{UploadAttachment,DownloadAttachment,ServeAttachment,DeleteAttachment}` |
| Tasks › Attachments › UI | `ADD_UI_COMPONENT` | `frontend/src/components/Attachments.tsx` |
| Tasks › Guidance enrichment | `ADD_FUNCTION` | `handlers/guidance_handler.go:{GetTaskGuidance,enrichTasksWithGuidance,AddGuidance,ReloadGuidance}`; repo `guidance_repository.go` |

## 5. Pull Requests

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| PR › PR entity | `ADD_DB_TABLE` | `backend/models/pr.go` → `pull_requests` (task_id, feature_id, url, title, branch, status, tested, version) |
| PR › Link PR to task/feature | `ADD_FUNCTION` | `handlers/pr_handler.go:{AddPullRequest,AddTaskPR}`; repo `pr_repository.go` |
| PR › New PR modal | `ADD_UI_COMPONENT` | `frontend/src/pages/PullRequestPanel.tsx`; `pr_handler.go:{NewPullRequestModal,GetPRForm}` |
| PR › List page | `ADD_UI_PAGE` | `frontend/src/pages/PullRequests.tsx`; routes `GET /api/v1/projects/:id/pull-requests` |
| PR › Mark as tested | `ADD_DB_COLUMN` + `ADD_FUNCTION` | `pull_requests.tested bool`; `pr_handler.go:MarkAsTested` |
| PR › Approve › model | `ADD_DB_TABLE` | `backend/models/approved_pr.go` → `approved_prs` (pull_request_id, user_id, approved_at, version) |
| PR › Approve / review | `ADD_FUNCTION` | `handlers/pr_review_handler.go:{ApprovePR,ReviewPR}`; repo `approved_pr_repository.go` |
| PR › Version stamp | `ADD_DB_COLUMN` | `pull_requests.version` |
| PR › PR dependencies | `ADD_FUNCTION` | `handlers/pr_dependency_handler.go:GetPRDependencyPanel` |

## 6. Releases (Release-First Workflow)

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| Releases › Release entity | `ADD_DB_TABLE` | `backend/models/release.go` → `releases` (project_id, tag, status, notes) + `release_prs` join; migration `database/migrations/20240813130000_create_release_tables.up.sql` |
| Releases › Create release | `ADD_FUNCTION` | `handlers/release_handler.go:CreateRelease`; dialog `frontend/src/pages/NewReleaseDialog.tsx` |
| Releases › Create release modal | `ADD_UI_COMPONENT` | `release_handler.go:NewReleaseModal`; `pages/Releases.tsx` |
| Releases › Assign features to release | `ADD_FUNCTION` | `release_handler.go:{AddFeaturesToRelease,UnassignFeatureFromRelease,AssignFeaturesFragment}` |
| Releases › Create feature under release | `ADD_FUNCTION` | `feature_handler.go:CreateFeatureUnderRelease` |
| Releases › Draft actions (HTMX dynamic) | `CHANGE_MODULE` | `handlers/web_release_handler.go:{RenderReleasesList,RenderReleaseDetail,RenderReleaseRow,*Fragment}` (see `HTMX_DYNAMIC_UPDATES_IMPLEMENTATION.md`, `RELEASE_DRAFT_ACTIONS_*.md`) |
| Releases › Dependency gate before release | `ADD_FUNCTION` | `handlers/release_dependency_handler.go:CheckDependenciesForRelease`; service `services/merge_gate.go`, `release_validator.go` |
| Releases › Finalize | `ADD_FUNCTION` | `release_handler.go:FinalizeRelease` |
| Releases › Notes edit | `ADD_FUNCTION` | `release_handler.go:UpdateReleaseNotes` |
| Releases › Detail page | `ADD_UI_PAGE` | `frontend/src/pages/ReleaseDetail.tsx`, `Releases.tsx` |
| Releases › GitHub release link | `ADD_DB_TABLE` | `backend/models/project_github.go` → `ReleaseGitHub` (`release_github`) |
| Releases › project_id fix | `CHANGE_FUNCTION` | `release_handler.go:CreateRelease` form binding (see `PROJECT_ID_FIX_SUMMARY.md`) |

## 7. Versions, Copies & Publishing

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| Versions › Snapshot model | `ADD_DB_TABLE` | `backend/models/feature_version.go` → `feature_versions` (project_id, number, tag, notes, major/minor, publish_number, feature_count, snapshot) |
| Versions › Save then publish | `ADD_FUNCTION` | version save/publish flow; `feature_versions.publish_number`, `major/minor` |
| Versions › Semantic numbering (v2.3) | `ADD_DB_COLUMN` | `feature_versions.{major,minor}` |
| Versions › View / restore a version | `ADD_API_ENDPOINT` | `GET /api/v1/projects/:id/versions/:versionId`, `.../restore` |
| Versions › Page | `ADD_UI_PAGE` | `frontend/src/pages/VersionsPage.tsx`; client `lib/working.ts` |
| Versions › Working state | `ADD_DB_TABLE` | `backend/models/working_state.go` → `working_states` (project_id, base_version_id, note) |
| My Space › Copy model | `ADD_DB_TABLE` | `backend/models/feature_copy.go` → `feature_copies` (base_version_id, owner_id, revision, name, source, snapshot) |
| My Space › Start a copy | `ADD_UI_COMPONENT` | `frontend/src/pages/StartCopyDialog.tsx`; routes `GET /api/v1/projects/:id/copies` |
| My Space › Dashboard | `ADD_UI_PAGE` | `frontend/src/pages/MySpaceDashboard.tsx`, `MyWorking.tsx`; `GET /api/v1/me/space`, `/me/copies` |
| Compare › Version diff | `ADD_UI_PAGE` | `frontend/src/pages/ComparePage.tsx`; client `lib/compare-tree.ts`; `GET /api/v1/projects/:id/versions/compare` |
| Merge › Copy back to project | `ADD_UI_PAGE` | `frontend/src/pages/MergePage.tsx`; client `lib/copy-tree.ts`; `GET /api/v1/projects/:id/copies/:copyId/merge` |
| Publish › Published list | `ADD_UI_PAGE` | `frontend/src/pages/PublishedList.tsx`, `PublishDialog.tsx`; `GET /api/v1/projects/:id/published` |
| Diff rendering | `ADD_UI_COMPONENT` | `frontend/src/components/DiffTree.tsx` |

## 8. Dependencies

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| Deps › Dependency model | `ADD_DB_TABLE` | `backend/models/dependency.go` → `dependencies` (parent_id/type, child_id/type, description) |
| Deps › CRUD | `ADD_FUNCTION` | `handlers/dependency_handler.go:{CreateDependency,ListDependencies,DeleteDependency,GetDependenciesListFragment}`; repo `dependency_repo.go` |
| Deps › Type selector / modal | `ADD_FUNCTION` | `dependency_handler.go:{ShowDependencyModal,ShowDependencyTypeSelector,GetDependencyPanels}` |
| Deps › Name enrichment | `ADD_FUNCTION` | `dependency_handler.go:enhanceDependenciesWithNames`; service `services/dependency_service.go` |
| Deps › Graph API | `ADD_API_ENDPOINT` | `GET /api/v1/projects/:id/dependency-graph` |
| Deps › Canvas UI | `ADD_UI_PAGE` | `frontend/src/pages/DependencyCanvas.tsx`; client `lib/dependency-layout.ts` |
| Deps › Markdown export | `ADD_UI_CLIENT_FN` | `frontend/src/lib/dependency-markdown.ts` |

## 9. Templates & Guidance

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| Templates › CRUD | `ADD_FUNCTION` | `handlers/template_handler.go:{GetAllTemplates,GetTemplateByID,AddTemplate,DeleteTemplate,ReloadTemplates}`; repo `template_repository.go` |
| Templates › Stacks | `ADD_FUNCTION` | `template_handler.go:{GetAvailableStacks,GetTemplateByStack,GetGuidancesByStack}` |
| Templates › Apply to project | `ADD_FUNCTION` | `handlers/apply_template.go:{ApplyTemplate,applyImportedTemplate}`; UI `frontend/src/pages/ApplyTemplateDialog.tsx` |
| Templates › Page | `ADD_UI_PAGE` | `frontend/src/pages/Templates.tsx` |
| Guidance › Import templates | `ADD_FUNCTION` | `template_handler.go:{SaveImportTemplate,DeleteImportTemplate}` |

## 10. Import

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| Import › From GitHub | `ADD_FUNCTION` | `handlers/import_handler.go:{ImportFromGitHub,ShowGitHubImportModal}`; repo `import_repository.go` (see `IMPORT_FEATURE_SUMMARY.md`) |
| Import › Project import | `ADD_FUNCTION` | `import_handler.go:{ImportProject,ShowProjectImportModal,ListAvailableImports}` |
| Import › UI | `ADD_UI_PAGE` | `frontend/src/pages/Imports.tsx` (see `IMPORT_UI_IMPLEMENTATION.md`); route `GET /api/v1/imports` |

## 11. GitHub Integration & MCP

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| GitHub › Project link model | `ADD_DB_TABLE` | `backend/models/project_github.go` → `project_github` (owner, repo, branch, last_synced_at, last_commit_sha) |
| GitHub › User OAuth model | `ADD_DB_TABLE` | `project_github.go` → `UserGitHub` (login, access_token, refresh_token) |
| GitHub › Connect / callback | `ADD_API_ENDPOINT` | `GET /api/v1/github/{connect,callback,account,repos}`; service `services/github_app.go`, `github_client.go` |
| GitHub › Panel UI | `ADD_UI_PAGE` | `frontend/src/pages/GitHubPanel.tsx` |
| GitHub › Feature data sync | `ADD_FUNCTION` | `handlers/project_connection_handler.go:SyncFeatureData` |
| MCP › Bridge service | `ADD_MODULE` | `backend/cmd/mcp-bridge/main.go`, `backend/internal/mcpbridge`, `services/github_mcp_service.go` (see `MCP_BRIDGE_SETUP.md`, `GITHUB_MCP_INTEGRATION.md`) |
| Linked Code › files model | `ADD_DB_TABLE` | `backend/models/feature_files.go` → `feature_files` |
| Linked Code › view | `ADD_UI_PAGE` | `frontend/src/pages/LinkedCode.tsx`; `feature_handler.go:GetLinkedCode`; client `lib/feature-file.ts` (see `LINKED_CODE_*.md`) |
| Linked Code › commits | `ADD_API_ENDPOINT` | `GET /api/v1/features/:featureId/commits` |

## 12. Contracts, Briefing & Drift

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| Contracts › Artifact model | `ADD_DB_TABLE` | `backend/models/contract_artifact.go` → `contract_artifacts` (feature_id, file_path, commit_hash, language, contract, behavior_note) |
| Contracts › Extract | `ADD_MODULE` | `backend/contracts/` (extractor), service `services/contract_service.go`; `handlers/contract_handler.go:GetContractView` |
| Contracts › Behavior notes | `ADD_FUNCTION` | `services/behavior_note_service.go` |
| Contracts › Page | `ADD_UI_PAGE` | `frontend/src/pages/Contracts.tsx`; route `GET /api/v1/projects/:id/contracts` |
| Briefing › Generate | `ADD_FUNCTION` | `handlers/briefing_handler.go:{GetBriefing,GetBriefingView}`; service `services/briefing_service.go` |
| Briefing › Page | `ADD_UI_PAGE` | `frontend/src/pages/BriefingPage.tsx`; route `GET /api/v1/projects/:id/briefing` |
| Drift › Detection | `ADD_MODULE` | `backend/services/drift_service.go` |
| Integration › Runner/checks | `ADD_DB_TABLE` + `ADD_MODULE` | `backend/models/integration_check.go`; `services/integration_runner.go` |

## 13. Backup & Restore

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| Backup › Export | `ADD_API_ENDPOINT` | `GET /api/v1/projects/:id/backup`; `cmd/backup/main.go`; client `lib/backup.ts` |
| Backup › UI | `ADD_UI_PAGE` | `frontend/src/pages/Backups.tsx` |
| Restore › Dialog | `ADD_UI_COMPONENT` | `frontend/src/pages/RestoreBackupDialog.tsx` (see `BACKUP_TESTING.md`) |

## 14. Playground & LLM Suggestions

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| Playground › Draft model | `ADD_DB_TABLE` | `backend/models/playground_draft.go` → `playground_drafts` (user_id, data) |
| Playground › Page | `ADD_UI_PAGE` | `frontend/src/pages/Playground.tsx`; client `lib/playground.ts`; routes `GET /api/v1/playground/{ai,saved}` |
| LLM › Suggest features | `ADD_FUNCTION` | `handlers/llm_suggest.go:{SuggestFeatures,SuggestFeaturesWeb}`; service `services/llm_service.go`, `claude_drafter.go` |
| LLM › Redaction | `ADD_MODULE` | `backend/services/redaction.go` |

## 15. Shared UI & Client Infrastructure

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| UI › App shell / layout | `ADD_UI_COMPONENT` | `frontend/src/layouts/AppShell.tsx` |
| UI › Side panel redesign | `CHANGE_UI_COMPONENT` | `AppShell.tsx` navigation (see `UI-REDESIGN-CHANGES.md`, `RELEASE_FIRST_UI_CHANGES.md`) |
| UI › Markdown editor/viewer | `ADD_UI_COMPONENT` | `frontend/src/components/{MarkdownEditor,Markdown,NoteEditor}.tsx` |
| UI › Dialog / primitives | `ADD_UI_COMPONENT` | `frontend/src/components/Dialog.tsx`, `components/ui/` |
| UI › Share dialog | `ADD_UI_COMPONENT` | `frontend/src/pages/ShareDialog.tsx` |
| Client › API layer | `ADD_UI_CLIENT_FN` | `frontend/src/lib/api.ts`, `queries.ts`, `types.ts` |
| Client › Router | `ADD_UI_CLIENT_FN` | `frontend/src/lib/router.tsx` |
| Client › Theme | `ADD_UI_CLIENT_FN` | `frontend/src/lib/theme.tsx` |
| Client › AI instructions helper | `ADD_UI_CLIENT_FN` | `frontend/src/lib/ai-instructions.ts` |

## 16. CLI (`featureplus-pr`)

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| CLI › Auth | `ADD_MODULE` | `pkg/featureplus/auth.go` |
| CLI › Link PR to feature/task | `ADD_MODULE` | `pkg/featureplus/pr.go`, `pr_test.go` |
| CLI › Release commands | `ADD_MODULE` | `pkg/featureplus/release.go`, `release_test.go` |
| CLI › Feature / project / task | `ADD_MODULE` | `pkg/featureplus/{feature,project,task}.go` |

## 17. Code-Mapping Tool (`tools/map`, Python)

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| Map › Pipeline orchestration | `ADD_MODULE` | `tools/map/pipeline.py`, `map.py`, `repo.py` |
| Map › Classification | `ADD_MODULE` | `tools/map/classify.py`, `vocab.py` |
| Map › Scoring | `ADD_MODULE` | `tools/map/{scoring,score}.py` |
| Map › Layout / canvas / spread | `ADD_MODULE` | `tools/map/{layout,canvas,spread}.py` |
| Map › Signals | `ADD_MODULE` | `tools/map/signals/{cochange,names,commits,schema,independence}.py` |
| Map › Reproduce / answer keys | `ADD_MODULE` | `tools/map/reproduce.py`, `answer_keys/*.csv` |

---

## 18. Configurable Feature Statuses (planned → implemented)

> Redesign: the fixed `todo/in_progress/done` enum becomes a per-project,
> parameterized status list configured in Project Settings. Each status may
> carry up to **3 parameter definitions** (UI name + type `string|integer`);
> the **values are entered per feature** when a feature takes that status.
> Modern React "sub-features" are features with `parent_feature_id`, so the
> `features` change covers them. Empty config ⇒ default `todo/in_progress/done`.

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| Statuses › Settings store | `ADD_DB_COLUMN` | `project_settings.statuses` TEXT/JSON — status defs `[{name, params:[{ui_name,key,type}]}]` |
| Statuses › Per-feature param values | `ADD_DB_COLUMN` | `features.status_params` TEXT/JSON — `{"assignee":"Vinod"}` |
| Statuses › Legacy sub-feature parity | `ADD_DB_COLUMN` | `sub_features.status_params` TEXT/JSON |
| Statuses › Domain model + validation | `ADD_MODULE` | `backend/models/feature_status.go` → `StatusDef`, `StatusParamDef`, `DefaultStatuses()`, parse/marshal, `CoerceParamValues()` |
| Statuses › Settings API | `CHANGE_FUNCTION` | `api/v1/project_settings.go` DTO `Statuses`+`StatusesDefault`, `UpdateProjectSettingsRequest`, validate+persist |
| Statuses › Project-aware feature validation | `CHANGE_FUNCTION` | `api/v1/features.go` (create default + validate), `handlers/feature_handler.go:{isValidStatus→statusAllowed,UpdateFeature,UpdateFeatureField,EditFeatureInline}`; store/prune `status_params` |
| Statuses › Feature DTO field | `CHANGE_FUNCTION` | `api/v1/dto.go:FeatureDTO.status_params` |
| Statuses › HTMX fragment lookup | `CHANGE_FUNCTION` | `handlers/feature_fragments.go` status switch → generic |
| Statuses › Legacy sub-feature validation | `CHANGE_MODULE` | `models/sub_feature.go`, `handlers/sub_feature.go` |
| Statuses › Client types | `CHANGE_UI_COMPONENT` | `frontend/src/lib/types.ts` (`FeatureStatus→string`, `StatusDef`, `status_params`) |
| Statuses › Status hook | `ADD_UI_CLIENT_FN` | `frontend/src/lib/queries.ts:useProjectStatuses` |
| Statuses › Settings editor | `ADD_UI_COMPONENT` | `frontend/src/pages/ProjectSettings.tsx` — structured grid (status rows + up to 3 param-def rows: name + type) + live preview |
| Statuses › Pill rendering | `CHANGE_UI_COMPONENT` | `frontend/src/components/FeatureBits.tsx:StatusPill` (configured label, fallback raw) |
| Statuses › List status cell w/ param hover | `ADD_UI_COMPONENT` | `frontend/src/components/FeatureBits.tsx:StatusCell` (pill + hover/focus compact box of param values); wired in `pages/ProjectDetail.tsx:FeatureRow` |
| Statuses › Filters | `CHANGE_UI_COMPONENT` | `frontend/src/pages/ProjectDetail.tsx` filter chips from configured statuses |
| Statuses › Feature status + param entry | `CHANGE_UI_COMPONENT` | `frontend/src/pages/FeatureDetail.tsx` status dropdown + per-param value inputs → `status_params` |

---

## 19. Feature List & Versions UI rework (implemented)

> A layout pass over the feature list header and the Versions page: a compact
> working-version summary, a save-then-publish checkbox, and a cleaner split of
> filters vs. list. All frontend; the save→publish checkbox reuses existing
> version/publish APIs.

| Feature / Subfeature | Plan | Parameters / code affected |
|----------------------|------|----------------------------|
| Feature list › Remove Versions & Share buttons | `CHANGE_UI_COMPONENT` | `pages/ProjectDetail.tsx` header (dropped `ShareDialog` use, `sharing` state, `History`/`Users`/`canManage` imports) |
| Feature list › Remove mini dashboard | `CHANGE_UI_COMPONENT` | `pages/ProjectDetail.tsx` (dropped `MiniStat` tiles + component, `stats`, `percent` import) |
| Feature list › Working pill "Based on / Changes" | `CHANGE_UI_COMPONENT` | `pages/ProjectDetail.tsx:WorkingBadge` → "Based on: ⟨v⟩ · Changes: None/N" |
| Feature list › Publish-after-save checkbox | `CHANGE_UI_COMPONENT` | `pages/ProjectDetail.tsx` checkbox + Save-as before the Note row; `publishAfterSave` state |
| Feature list › Save then publish | `CHANGE_FUNCTION` | `pages/PublishDialog.tsx:SaveVersionDialog` `publishAfter` prop → `useSaveVersion` then `usePublishVersion` |
| Feature list › Filters light box | `CHANGE_UI_COMPONENT` | `pages/ProjectDetail.tsx` search/filters in own `Card bg-raised/50`, list in separate card |
| Feature list › "Feature List" heading + action pills | `CHANGE_UI_COMPONENT` | `pages/ProjectDetail.tsx` background `<h3>` with Arrange / Add feature / Refresh beside it |
| Versions › Working-version summary moved to header | `CHANGE_UI_COMPONENT` | `pages/VersionsPage.tsx` line below project name: "Current version is  Based on: ⟨v⟩ · Unchanged/Changed (+`Counts` diffs)" + Go to working version pill |
| Versions › Save + grouped Publish checkbox | `CHANGE_UI_COMPONENT` | `pages/VersionsPage.tsx` Save-as + Publish checkbox grouped (non-wrapping); `publishAfter` → `SaveVersionDialog` |
| Versions › Drop working row from table | `CHANGE_UI_COMPONENT` | `pages/VersionsPage.tsx:VersionsTable` (removed working `<tr>`, `onSave` prop, `setWorkingNote`/`RotateCcw`/`useSetWorkingNote`) |

---

### How to extend this map (forward use)

1. Name the feature path `Domain › Feature › Subfeature › detail` (1–4 levels).
2. Pick a plan verb from the vocabulary table.
3. In column 3, write the **exact** table+column, component file, module path, or
   `path:Function` you added or changed — mirroring the existing rows above.
4. One feature may span several rows (e.g. `ADD_DB_COLUMN` + `ADD_FUNCTION` + `CHANGE_UI_COMPONENT`).
