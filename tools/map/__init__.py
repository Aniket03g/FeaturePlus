"""
/map - build a feature -> files map for a git repository.

The engine behind the /map skill. Read-only: it clones nothing, writes nothing
into the target repo, and calls no model. Naming and grouping of the raw terms
it produces is the model's job, downstream of this package.

Layout:

    vocab.py            words, stopwords, noise filters (shared by all signals)
    repo.py             file discovery, file reads, git history
    spread.py           term -> per-file ownership
    classify.py         aggregator / split-logic / vendored buckets
    signals/names.py    code layout: pages, routes, DIRECTORY NAMES
    signals/schema.py   data model: migrations, ORM models, generated types
    signals/commits.py  commit-message vocabulary and direct file attribution
    signals/cochange.py co-change graph, history health, communities
    signals/independence.py  whether two signals are really two signals

Provenance: every function here was moved out of
docs/map-skill/trial/measure_v2.py and measure_v3.py, which produced the three
measurement passes reported in docs/map-skill/trial/report-trial3.md. The moves
are verbatim except where a docstring says otherwise - the exceptions are the
determinism fixes in spread.feature_spread, signals.commits.commit_attribution
and signals.cochange.cochange_communities, and the promotion of directory names
to a first-class signal in signals.names.

`reproduce.py` is the check that the move changed nothing.
"""

__all__ = ["classify", "repo", "signals", "spread", "vocab"]
