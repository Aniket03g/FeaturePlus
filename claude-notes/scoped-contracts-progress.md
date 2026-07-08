# Scoped Contracts — Progress Log

Running log of implementation progress for the "Scoped Contracts" FeaturePlus project (ID: 51, `scoped-contracts-51.md`). Appended after each task: what was done, key decisions, anything skipped or deferred. Git commits are the code-level history; this file is the "why" alongside them.

## 2026-07-08 — Project created

- Concept note (`reports/scoped-onboarding-contracts-idea.docx`) converted into a FeaturePlus project via `/plan`.
- Project: Scoped Contracts (ID 51) — 6 features (185-190), 25 tasks (203-226).
- Backup of `backend/` taken before starting: `backend-backup-2026-07-08.zip`.
- Implementation order: Feature-Scoped Access Control → Contract Extractor → AI Behavior Notes → Mock & Fixture Generator → Contract Versioning & Drift Detection → Trusted Integration CI Runner.
- Note: `featureplus-pr` CLI task-type validation only accepts `backend`/`frontend`/`test`; DB/DevOps-typed tasks were created with the nearest accepted CLI value. The MD file (`scoped-contracts-51.md`) retains the correct richer type labels.

---

## 2026-07-08 — Implementation run (Opus 4.8)

**Workflow decisions:**
- One git branch per feature (`fp/<feature-slug>`), one commit per task. Per-task branches abandoned — `featureplus-pr upload` requires a GitHub PR/remote which this local repo lacks, so per-task branches add no value.
- Only my own changed files are staged per commit; pre-existing working-tree modifications on `mapping` are left untouched.
- Task-level "done" can't be synced to FeaturePlus: the Task model has no status field (only Feature has Status), and `upload` needs a GitHub PR. Progress is tracked here + in git; feature-level status updated where possible.

### Feature 1: Feature-Scoped Access Control (185) — branch fp/feature-scoped-access-control

- **[DB] Design scope/ACL data model (203)** ✓
  - New `backend/models/feature_scope.go`: `FeatureAccessLevel` enum (owner/contract/none) with `IsValid()`/`Rank()`, and `FeatureScope` model (project, feature, user, access_level, granted_by) with a unique index on (user, feature).
  - Registered in `main.go` AutoMigrate list.
  - Decision: only explicit grants (typically `owner`) are stored. Contract access to dependencies is *derived* from the dependency graph by the middleware, not stored per-file — keeps grants minimal and avoids drift between stored ACLs and the graph.
  - commit 12a58c3

- **[Backend] ACL middleware for file/API access checks (204)** ✓
  - `backend/services/access_service.go`: `AccessService` resolves effective access. `EffectiveFeatureAccess(user, project, feature)` = max of explicit grant, project-owner bypass, derived-contract (feature is a dependency of an owned feature). `ResolveFileAccess(path)` maps a file to owning feature(s) via `feature_files` JOIN and returns the most permissive level; unowned files → none (invisible).
  - `backend/middleware/scope.go`: `FeatureScopeMiddleware(db, param, minLevel)` — 404 for no access (invisible, not 403), 403 below tier, stashes `feature_access` + `feature_project_id` in context. `toInt` normalizes the uint user_id set by AuthMiddleware.
  - Dependency direction confirmed: "Child depends on Parent"; deps of feature F = rows where child_id=F, take parent_id.
  - commit 01ec11d
- **[UI] Scope assignment UI on feature detail page (205)** ✓
  - `handlers/scope_handler.go` + `templates/feature-scopes.html`, embedded in `feature-detail.html` (loads via HTMX after linked-code). Owner grants owner/contract per collaborator, upsert on (user,feature), revoke. Owner-only enforced server-side.
  - Routes: GET/POST `/web/features/:id/scopes`, DELETE `/web/features/:id/scopes/:scope_id`. Registered handler + template in main.go.
  - **Verified live**: restarted server, fragment renders (HTTP 200, "Feature Access" + grant form), granted contract to user 4 (contract badge shown), revoked OK.
  - commit 6ba8144
- **[Testing] ACL enforcement tests (206)** ✓
  - `services/access_service_test.go`: 6 tests, in-memory SQLite. Owner/contract/none, project-owner-sees-all, non-collaborator-none, explicit-grant-honored, shared-dependency edge (own B → contract on shared A, sibling C stays none). All pass.
  - commit 8a390bc

**Feature 1 COMPLETE.** Server restarted on new code and left running.

### Feature 2: Contract Extractor (186) — branch fp/contract-extractor

- **[Backend] Go AST parser (207)** ✓ — `backend/contracts/extractor.go`, `ExtractGoContract`. go/ast based; keeps exported funcs/methods/types/fields + doc comments, strips bodies, drops unexported + imports. Doc comments rendered manually (printer mishandles positions on mutated nodes). Untyped vars keep initializer to stay valid Go; typed vars keep type only; const enum values kept. Route extraction deferred (routes live in bodies we strip; routes.txt exists separately). commit 8ddc059
- **[Backend] Wire to GetLinkedCode graph (208)** ✓ — `services/contract_service.go`, `TargetsForOwnedFeature`/`TargetsForUser`: dependency features' files = contract targets, de-duped, excluding files the user owns outright. commit 190a675
- **[DB] Persist versioned artifacts (209)** ✓ — `models/contract_artifact.go` (unique idx feature+file+commit), `SaveArtifact` (upsert same commit / new version new commit), `LatestArtifact`, `ArtifactAtCommit`. commit 114456b
- **[Backend] Serve contracts vs source (210)** ✓ — `handlers/contract_handler.go` `ServeFile` at GET /api/projects/:id/files?path=. none→404 (invisible), contract→stripped (never source), owner→real source. Injectable `SourceReader`; `FSSourceReader` confines to base dir (path-traversal rejected). **Verified live**: 404 for unmapped file. commit d66fb6c
- **[Testing] Extractor unit tests (211)** ✓ — 11 tests in `contracts/extractor_test.go` + no-leak/persistence/traversal tests in services. All pass. commit f026bae

**Feature 2 COMPLETE.** Security property verified: contract output never contains bodies or unexported members.

### Feature 3: AI Behavior Notes (187) — branch fp/ai-behavior-notes

- **[Backend] Behavior-note generation call (212)** ✓ — `services/behavior_note_service.go`, injectable `NoteGenerator` (Gemini prod / fake in tests via `llm.GenerateWithGemini`). `GenerateNote` = single LLM call, prompt shares only the stripped contract + feature/task context, output wrapped as `// BEHAVIOR NOTE (auto-generated):` block. commit 18534d8
- **[DB] Cache notes on artifact (213)** ✓ — `EnsureNote` generates once, persists on `ContractArtifact.BehaviorNote`, returns cache on repeat (no LLM re-call); per-commit artifact versioning means drift regenerates. `ContractWithNote` appends note; `ServeFile` serves note-augmented contract. commit a97f6a9
- **[Testing] Note gen + caching tests (214)** ✓ — call-counting fake proves once-and-cache, drift-regenerates, force-regenerates, append. commit 5d1abb8

**Feature 3 COMPLETE.** (Note: live LLM calls need GEMINI_API_KEY; logic fully covered by fake-generator tests.)

### Feature 4: Mock & Fixture Generator (188) — branch fp/mock-fixture-generator

- **[Backend] Mock function stubs (215)** ✓ — `contracts/mockgen.go` + `contracts/imports.go`. `GenerateMock`: contract → compilable mock package. Named return values (bare return = valid zeros), sentinel-error dispatch on magic string inputs (ErrTrailNotFound→"trail-not-found"), pointer-to-struct returns get synthetic fixtures, imports re-added. Verified compiles standalone. commit 24ebe3f
- **[Backend] Synthetic fixtures from struct shapes (216)** ✓ — `contracts/fixtures.go`. Keyed composite literals (unfillable fields default to zero → always compiles), recurses into nested structs, fills slices with one element, depth-bounded. Never from real data. Verified nested+slice+pointer compile. commit 0ff859c
- **[DevOps] Serve mocks into local build (217)** ✓ — `ContractService.MockFor` + `ContractHandler.ServeMock` at GET /api/projects/:id/mocks?path=. none→404, owner→409, contract→mock with derived *_mock.go filename. commit 3d4f138
- **[Testing] Mocks satisfy error cases (218)** ✓ — 3 tests incl. one that compiles+RUNS the generated mock, asserting sentinel errors returned for magic inputs + synthetic happy path. commit 8943879

**Feature 4 COMPLETE.** Generated mocks proven to compile and behave correctly at runtime.

### Feature 5: Contract Versioning & Drift Detection (190) — branch fp/contract-versioning-drift

- **[Backend] Detect commit drift (223)** ✓ — `services/drift_service.go`. Injectable `CommitResolver` (`GitCommitResolver` = `git log -1 --format=%H -- <path>`). `CheckDrift` compares latest artifact commit vs current; returns `DriftStatus`. Unknown commits → non-drifted (never fails a read). commit 5652c87
- **[Backend] Trigger regeneration on drift (224)** ✓ — `RegenerateIfDrifted` re-extracts + persists fresh artifact at current commit when stale/missing; empty note → note regenerates next request. Safe no-op when source/commit unavailable. commit c1260ec
- **[UI] Surface drift warning (225)** ✓ — wired `GitCommitResolver` in main.go; `ServeFile` adds `stale` flag; `GetContractView` (GET /web/projects/:id/contract-view?path=) renders `contract-view.html` with amber staleness banner (artifact vs current commit) or up-to-date badge. Server starts cleanly (template parses). commit 79dfce7
- **[Testing] Drift-detection tests (226)** ✓ — fake resolver: match=no drift, moved-ahead=drift, no-artifact, unrelated-file-change=no drift, regenerate-then-noop. All pass. commit f24a237

**Feature 5 COMPLETE.**

### Feature 6: Trusted Integration CI Runner (189) — branch fp/trusted-integration-ci-runner

- **[DevOps] Privileged runner swaps mock for real (219)** ✓ — `services/integration_runner.go`. Injectable `CommandRunner` (ExecCommandRunner prod / fake test). `RunIntegration` overwrites the collaborator's mocks with real source in a workDir, runs the test cmd, returns raw privileged `RunResult`. commit a0301a3
- **[Backend] Result redaction (220)** ✓ — `services/redaction.go`. `Redact` → `RedactedResult` (pass/fail + generic summary + sanitized hints). Strips file:line refs, path-like tokens, and known secrets; drops any hint still containing a secret (defense in depth). commit c5bbc7a
- **[Backend] Gate merge on human review (221)** ✓ — `models/integration_check.go` + `services/merge_gate.go`. `RecordIntegrationCheck` stores only redacted summary. `Evaluate` requires latest-check-passed AND ≥1 human approval; Allowed = "a human may merge", never auto-merge. Registered model. commit 626961b
- **[Testing] Redaction correctness (222)** ✓ — 10 tests: no-leak redaction (repo root/file names/internal symbols stripped, contract assertion preserved), runner swap+exit-code, merge-gate all four states + latest-check-wins. Also fixed flaky `LatestArtifact` ordering (added `id desc` tiebreak). commit 7b394f5

**Feature 6 COMPLETE.**

---

## RUN COMPLETE — 2026-07-08

All 6 features / 24 tasks implemented, one branch per feature, one commit per task (25 commits total incl. the ordering fix).

**Final verification:** `go build main.go` OK · `go test ./services/ ./contracts/` = 42 PASS · server boots clean with all new migrations (feature_scopes, contract_artifacts, integration_checks), routes, and templates.

**Branches (each off `mapping`):**
- fp/feature-scoped-access-control
- fp/contract-extractor
- fp/ai-behavior-notes
- fp/mock-fixture-generator
- fp/contract-versioning-drift
- fp/trusted-integration-ci-runner

**Not synced to FeaturePlus:** task-level status can't be marked done (Task model has no status field; `upload` needs a GitHub PR). Tracked via git + this log. Live LLM (behavior notes) needs GEMINI_API_KEY; logic covered by fake-generator tests.

**Known scoping decisions / limitations:** HTTP-route extraction deferred (routes live in stripped bodies; routes.txt exists separately). Import resolution in mocks is heuristic (std-lib map + fallback). Contract serving reads source from repo root via FSSourceReader; a production deploy would inject a git-worktree-backed reader.
