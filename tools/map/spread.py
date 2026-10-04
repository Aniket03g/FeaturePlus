"""
Which feature dominates each file, and which others come close.

This is the step that turns a vocabulary into a per-file assignment, so it is
where the file-level mapping decision from trial 3 actually lands.

Counting mere presence badly overstates sharing - a quote page naturally names
accounts and products without being an accounts file. So terms are ranked by
mention count and a file is only multi-feature when a rival reaches
`rival_ratio` of the dominant one. Terms below that are recorded as
references, which is what a cross-feature dependency edge looks like.
"""

import re

from .repo import read_text


def feature_spread(repo, files, vocab, min_mentions, rival_ratio,
                   deterministic=True):
    """
    For each file: owner term, rival terms, and reference terms.

    DETERMINISM FIX (the known v4 defect). `vocab` is a set, so `hits` was built
    in set-iteration order and `sorted(..., key=-count)` - being a stable sort -
    broke ties in that order, which varies per process under hash
    randomisation. A file mentioning `task` and `project` exactly 5 times each
    could be owned by either, differently on each run, and every downstream
    number (multi-feature share, community purity) moved with it.

    With `deterministic=True` terms are scanned in sorted order and ties break
    on the term name. Pass `deterministic=False` to reproduce the trial's exact
    behaviour, which the reproduction check uses.
    """
    terms = sorted(vocab) if deterministic else list(vocab)
    patterns = {
        term: re.compile(rf"\b{re.escape(term)}s?\b", re.IGNORECASE) for term in terms
    }
    spread = {}
    for f in files:
        text = read_text(repo, f)
        if not text:
            continue
        hits = {}
        for term in terms:
            n = len(patterns[term].findall(text))
            if n >= min_mentions:
                hits[term] = n
        if deterministic:
            ranked = sorted(hits.items(), key=lambda kv: (-kv[1], kv[0]))
        else:
            ranked = sorted(hits.items(), key=lambda kv: -kv[1])
        if not ranked:
            spread[f] = {"owner": None, "rivals": [], "refs": [], "counts": {}}
            continue
        top_term, top_n = ranked[0]
        rivals = [(t, n) for t, n in ranked[1:] if n >= rival_ratio * top_n]
        refs = [(t, n) for t, n in ranked[1:] if n < rival_ratio * top_n]
        spread[f] = {
            "owner": top_term,
            "owner_n": top_n,
            "rivals": rivals,
            "refs": refs,
            "counts": hits,
        }
    return spread


def term_dispersion(spread, vocab):
    """
    Shape of each term's footprint across the repo.

    A real feature occupies a small tight cluster of files that mention it a
    lot; a route fragment like 'first' appears in exactly one file (the router)
    and nowhere else. Trial 3 kept this as a diagnostic; the mapper uses it as a
    ranking input, since a term owning zero files is almost never a feature.
    """
    rows = {}
    for term in vocab:
        counts = [v["counts"][term] for v in spread.values() if term in v["counts"]]
        owned = sum(1 for v in spread.values() if v["owner"] == term)
        if not counts:
            rows[term] = {"files": 0, "owned": 0, "total": 0, "max": 0, "top_share": 0.0}
            continue
        tot = sum(counts)
        rows[term] = {
            "files": len(counts),
            "owned": owned,
            "total": tot,
            "max": max(counts),
            "top_share": max(counts) / tot,
        }
    return rows
