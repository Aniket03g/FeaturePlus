# Provenance and reproduction

Every function in `tools/map/` was moved out of `docs/map-skill/trial/measure_v2.py`
and `measure_v3.py`, which produced the three measurement passes written up in
`docs/map-skill/trial/report-trial3.md`. The moves are verbatim except where a
docstring says otherwise.

## Deliberate changes made during the move

| Change | Where | Why |
|---|---|---|
| Deterministic tie-break on term name | `spread.feature_spread` | The trial iterated a `set`, so ownership of a tied file varied per process under hash randomisation. This is the "owner assignment is order-dependent" defect listed for v4. |
| Deterministic term/file ordering | `signals.commits.commit_attribution` | Same defect, same fix. `commit_attribution_legacy` retains the old behaviour for the reproduction check. |
| Deterministic label propagation | `signals.cochange.cochange_communities` | Nodes were visited in dict-insertion order and ties broken by `Counter.most_common`, so M10c purity moved between runs. Now sorted nodes, lowest-label tie-break. |
| Directory names promoted to a real signal | `signals.names.features_from_dirs` | Existed only as inline lines in trial 3's `main()`. It is the candidate fix for Next.js App Router blindness, and the mapper needs term→files, which the trial discarded. |
| `schema_file_map`, `collect_tables` | `signals.schema` | New helpers exposing term→files. No change to any vocabulary. |

Legacy behaviour is reachable via `analyze(..., legacy=True)` and is used only
by `reproduce.py`.

## Running the gate

```
python -m tools.map.reproduce "D:\GROVE SYSTEMS\working proxy - Leads" --prove-flaky
python -m tools.map.reproduce "D:\TaskTrackerGo"
```

It runs the original `measure_v3.py` as a subprocess and the library in legacy
mode over the same repo, then diffs the metric rows field by field.

Result on 2026-08-17:

- **Grove CRM** — 42/43 fields identical. The mover is `community_purity`, and
  `--prove-flaky` shows the *original* moving 33.3 → 30.0 across hash seeds
  while the library in deterministic mode does not move at all.
- **TaskTrackerGo** — 43/43 identical.

## Reproducing the published trial-3 Grove report

`report-v3-grove-crm.md` was produced with arguments that are not recorded in
`run_trial3.sh` (Grove is the control repo and was run by hand). They are:

```
measure_v3.py "D:\GROVE SYSTEMS\working proxy - Leads" --exclude bckup --drop user
```

- `--exclude bckup` — a stale backup directory, 27 files. Without it the file
  count is 97 rather than the reported 70. This is the same by-hand correction
  v1 made.
- `--drop user` — without it the corroborated vocabulary is 8 terms
  (`user` included) rather than the reported 7, which shifts multi-feature
  share from 24.3% to 28.6%.

With both flags the library reproduces the published report exactly: files 70,
commits 103, usable 57, co-change coverage 78.6%, directory agreement 41.6%,
vocabulary 7, multi-feature 24.3%, aggregator 4, split-logic 9, unclear 4,
shared bucket 2, tables 3.

That `--drop user` was needed by hand is itself worth remembering: it is a
manual correction applied to the control repo, so Grove's numbers are slightly
more curated than the 12 vibecoded repos', which were run with no flags at all.
