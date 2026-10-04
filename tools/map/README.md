# tools/map

Builds a **feature → files** map for a git repository, from four signal classes:
commit messages, code layout (pages/routes/directory names), the data model, and
co-change history.

Read-only. Nothing is written into the target repo, and no model is called.

```
python -m tools.map.map <repo> [--label NAME] [-o OUTDIR]
                        [--top N] [--min-score F]
                        [--exclude DIR] [--drop TERM]
```

Outputs, per repo:

| File | Purpose |
|---|---|
| `map-<label>.md` | human review sheet: ranked features, per-file evidence, health warnings |
| `map-<label>.json` | full result including buckets, rivals and below-the-cut terms |
| `feature_files-<label>.csv` | `feature_name,file_path,confidence` — the shape FeaturePlus's `feature_files` table wants |
| `canvas-<label>.md` | the same map in the format FeaturePlus's dependency canvas reads — open it there to look at the extraction as a picture |
| `features-<label>.md` | feature names only, no status or arrows — open it in FeaturePlus's **Playground** to review and import |

## Looking at a map in FeaturePlus

`canvas-<label>.md` is written for `frontend/src/lib/dependency-markdown.ts`,
the hand-written map format the dependency canvas already parses. Open the
canvas, open its **Markdown** panel, and drop the file in — no project, no
import, no API. It is the cheapest way to ask the only question that matters:
does the picture look right to the person who wrote the code?

Features are emitted **flat** and all marked `[done]`. Flat because deciding
that `login`, `role` and `permission` are parts of one Security feature is a
naming step this package deliberately does not do; `[done]` because a feature
read out of a repository is, by definition, already built.

Arrows come from **import direction**: where two or more of one feature's files
import another feature's files, the first is drawn as requiring the second.
Co-change is not used — it is symmetric, so it can support an arrow but never
be its source.

### Measured: arrows are much sparser than files

Of 151 internal imports in Grove CRM, **12 had a feature at both ends** and one
arrow survived; TaskTrackerGo gave one arrow from 14 imports. Two causes, both
structural rather than fixable by tuning:

- An arrow needs *both* ends attributed, so the ceiling is roughly attribution
  coverage squared — 48% coverage on Grove is a 23% ceiling before anything else.
- Imports preferentially target exactly what the bucketer removes. On Grove the
  targets were 36 aggregator, 24 plumbing, 26 below the confidence floor, 34
  outside the source set — because shared, widely-imported code *is* what
  plumbing and wiring are.

Allowing below-floor endpoints to carry an arrow (never to own a file) was
measured: Grove 1 → 3 arrows, and the three were `quote → number`,
`auth → detail` and `user → login` — two junk terms and one part-of relationship
mislabelled as a dependency. Not adopted.

The run prints the whole breakdown, because "no arrows" has two very different
causes and a reviewer needs to know which one they are looking at.

## Design in one paragraph

Commit messages lead, because they are the only signal independent of code
layout by construction and they attributed 43–97% of files across the 13-repo
trial sample. Features are **ranked, never gated** — the v2 rule "a term named
by two signals is real" inverted on vibecoded repos and returned nothing at all
on Next.js App Router, and a gate that fails closed hands back an empty map.
Files that should not belong to any one feature (nav bars, static pages,
vendored UI kits) are **bucketed and reported**, not silently attributed. Every
row carries its evidence, because the output is a draft for a human to correct.

## Turning raw terms into feature names

The engine emits raw vocabulary — `booking`, `bookings`, `reserve` are three
terms. Merging and naming them is a separate step done by the model, downstream
of this package. Keeping it out of here is what makes the engine reproducible
and free to run.

## Known limitation, measured

The directory-name signal was added to fix Next.js App Router blindness, where
the feature name lives in the directory (`app/bookings/page.tsx`). It works
there and on feature-first layouts generally. It **misleads on layer-first
layouts**: in an idiomatic Go repo the directories are `handlers/`, `models/`,
`middleware/`, which are architectural layers, not features — so those words
score as top-ranked features. See the TaskTrackerGo run in Phase 2 notes. This
is the first measured case where one rule genuinely needs to differ by stack.

## Reproduction

See `PROVENANCE.md`. `python -m tools.map.reproduce <repo> [--prove-flaky]`
diffs this library against the original trial script field by field.

## Round three: what a word has to be before it can own a file

Round two got the file tree read correctly. Round three is about the words
themselves — measured on the same two repos, Grove CRM and TaskTrackerGo.

**A top-level `models/` folder was invisible.** The trial tested `"/model" not
in f`, which needs a leading slash, so a repo that keeps its models at the root
— the normal Go and Django layout — produced no schema signal at all. That one
test is why TaskTrackerGo had no tables, nothing proposed `user`, and
`models/user.go` could not be placed. `in_model_dir` now matches path segments.
The result: `user` appears as a feature, `models/user.go` is placed, and every
term's rank rises because a whole signal class came back (`task` 0.27 → 0.51).

**Capability words don't own files.** `email` is not what any file is about —
it is something the whole app does. On Grove it had taken `send-email.ts` (a
quote file: it emails a quote) and `authorize.go` (a user file: it emails on a
failed login). Both statements are true and neither names a feature. Same
treatment as the architectural role words, and the same escape hatch: a repo
that declares an `emails` table has said in its own schema that the word names
an entity, and the mute lifts.

**A word only one file mentions is that file, not a feature.** `login`,
`callback`, `change` and `credential` each entered Grove's vocabulary because a
page is named after them, confirmed themselves with the same filename, and
claimed that one file. The evidence is a circle. `auth` scores no better than
they do, but it has a directory, handlers in two layers and commit traffic, so
it survives a rule that a raw score cut would have killed it with.

**A filename beats the prose inside the file when they disagree.** A name is a
claim about what a file *is*; the words inside it include everything it merely
uses. `lead-detail.astro` says "account" more often than "lead", because a lead
has an account, and on raw counts that was enough to file it under account. A
contradicted prose vote is now halved rather than silenced, so overwhelming
prose can still win — which is the right answer for a file whose name has gone
stale.

Terms these rules exclude are still ranked and still shown, under _Considered
and not used_ with the reason, so a reviewer can overrule any of them.

## Third repo: beatseek (Elixir / Phoenix LiveView)

Grove (Astro/TS) and TaskTrackerGo (Go) were the only two repos the round-two and
round-three rules were measured on. `w0rd-driven/beatseek` — a Phoenix LiveView app
that tracks artists and albums and notifies you about new releases — is the third,
and the first non-imperative-web stack.

**It was invisible at first.** `SOURCE_EXT` had no Elixir entries, so 162 of the
repo's 165 source files were filtered out before any signal ran: 3 files, every
feature scoring 0.00. Added `.ex`, `.exs`, `.heex` — the template half of a
LiveView carries the feature word as often as the module beside it.

**With that, the top four features are the repo's actual four**: `album` (0.89),
`artist` (0.88), `notification` (0.60), `user` (0.43), 76% of files placed, and the
`*_live/` directory convention feeds the file-tree signal cleanly. No new rule was
needed for the layout — round three's directory handling already transferred.

**`vendor/` as a path segment is now vendored.** `assets/vendor/topbar.js` reached
the review sheet as a guess (`asset`, 0.09). `VENDOR_HINTS` only listed shadcn-style
React paths; a path segment literally named `vendor` is the convention in Go, Rails
and Phoenix alike.

Both Phase 0 gates still pass 43/43 after these changes.

### Still open, now confirmed on three repos rather than two

- **Framework bookkeeping tables become feature candidates.** `schema_migrations`
  and `users_tokens` are Ecto's own tables; they arrive with the "declared table"
  credit that the rules treat as proof a word names an entity.
- **The declared-table escape hatch doesn't lift the file-tree mute.** `notification`
  is muted as an architectural role word *and* credited with a declared table in the
  same row — the mute should have lifted, as it does elsewhere.
- **Commit-message noise words** (`complete`, `draft`, `stub`, `styling`) reach the
  review sheet here exactly as they do on Grove. Third repo, same defect.
- **Naming/grouping** is again the largest error source: `user` + `account` + `token`
  + `verification` are one feature, and nothing below the model step can merge them.

## Fourth repo: Career-Cloud (C# / .NET, layer-first)

`msemakula/Career-Cloud` is a job portal built as a five-project .NET solution. It
is the hardest repo tried so far and it broke the tool in three independent ways
before producing anything. All three are now fixed, and it ends up the most
accurate run of the four.

**1. `.cs` was not a known extension.** Same class of bug as Elixir, but it failed
better: with zero recognised files the tool says "no tracked source files found"
rather than printing a confident empty map. Added `.cs`, `.cshtml`, `.razor`.

**2. The vendored detector claimed 60 of 64 files.** `vendored_by_history` flags a
directory when 80%+ of its files arrived in a commit touching 15+ files, on the
reasoning that application code accretes a few files at a time. This repo was
uploaded through the GitHub web UI in a handful of 20-file commits, so hand-written
code matched "dropped in whole" exactly. Vendored code is a *pocket* of a repo by
definition, so a verdict covering more than `MAX_VENDORED_SHARE` (50%) of the files
is now dropped whole — it is describing how the author commits, not what the code
is. Highest genuine rate in the 13-repo trial was 24%.

**3. Filenames were barred from proposing features, and were the only signal left.**
There are no pages or routes (a class library), no SQL (Entity Framework declares
tables in code), the directories are pure architecture (`BusinessLogicLayer`,
`Pocos`), and **every commit message is GitHub's default "Add files via upload"** —
the leading signal carrying literally zero information, and the source of the junk
terms `upload` and `delete`. Everything the repo knows about itself is in
`ApplicantResumeRepository.cs`.

`recurring_filename_terms` lets a filename word propose when it recurs across **3+
files in 2+ directories**. That answers the objection the confirm-only rule was
written for — `debounce.ts` is one file in one directory and still cannot propose —
while `applicant` (18 files, 3 directories) can. The two-directory test is also what
separates a feature from a layer: a feature recurs across layers, a layer word stays
in its own folder (`logic` and `poco` are each confined to one directory here).
Filename recurrence is scored like a directory name (0.75), or real features rank
below junk: before the scoring half of the change, `framework` with 0 files
outranked `company` with 20.

### Measured

Scored against `answer_keys/career-cloud.csv` with `score.py`:

| | Before | After |
|---|---:|---:|
| Files placed | 0 of 64 | 62 of 64 |
| On the right feature | — | **90%** |
| applicant / security / reference recall | — | 100% |
| company recall | — | 95% |
| Genuine feature-to-feature mix-ups | — | 1 |

The cost, measured rather than assumed: Beatseek loses exactly one row (61 → 60
exact), `user_reset_password_live_test.exs` moving to a new `password` term. That is
the naming/grouping problem, not a new failure mode. Both Phase 0 gates still pass —
TaskTrackerGo 43/43, Grove 42/43 on the known-flaky `community_purity`.

### What two keys now agree on

- **The plumbing bucket is the top defect.** 0 of 7 here, 0 of 15 on Beatseek. It has
  never once fired correctly on a repo outside Grove.
- **Naming/grouping is the biggest remaining gap, and now it has a number.** 29% of
  Career-Cloud's rows are "right feature, wrong word": `login` + `role` are
  `security`, `system` + `code` are the reference-data feature. The files are
  correctly grouped; only the labels are split.
- **Platform words leak in.** `system` ranks first here because every C# file says
  `using System;`, exactly as `phoenix` did on Beatseek.
