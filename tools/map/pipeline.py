"""
One analysis pass over a repository, shared by the mapper and the reproduction
check.

Everything expensive happens here exactly once: the file list, the four signal
classes, the per-file spread, the classification buckets and the history
measures. `map.py` turns the result into a feature map; `reproduce.py` turns it
into the trial-3 metrics row so the refactor can be proved behaviour-preserving.

`legacy=True` reproduces the trial's exact behaviour including its
order-dependence, and exists only for that proof. The mapper always runs with
`legacy=False`.
"""

import collections
from dataclasses import dataclass, field
from pathlib import Path

from .classify import (classify_contested, import_indegree, outdegree,
                       vendored_by_history)
from .layout import container_terms, detect_shapes, feature_dir_terms
from .repo import (is_vendor, log_with_root, parse_log, source_files, sql_files)
from .signals.cochange import (cochange_communities, cochange_vs_directory,
                               community_purity, history_health)
from .signals.commits import (commit_attribution, commit_attribution_legacy,
                              commit_vocabulary)
from .signals.independence import signal_classes
from .signals.names import (dir_vocab, features_from_dirs,
                            features_from_filenames, features_from_pages,
                            recurring_filename_terms,
                            features_from_routes)
from .signals.schema import (collect_tables, features_from_config,
                             schema_file_map, table_vocab)
from .spread import feature_spread, term_dispersion
from .vocab import STOPWORDS, singular, usable


@dataclass
class Analysis:
    repo: Path
    label: str
    files: list
    all_files: list
    vendor_path: list
    sqls: list

    # vocabularies, per raw signal
    cfg_vocab: set = field(default_factory=set)
    page_vocab: set = field(default_factory=set)
    route_vocab: set = field(default_factory=set)
    schema_vocab_old: set = field(default_factory=set)
    schema_vocab_new: set = field(default_factory=set)
    dirs_vocab: set = field(default_factory=set)
    commit_vocab: set = field(default_factory=set)

    # term -> files, per signal (what a map needs and the trial discarded)
    page_files: dict = field(default_factory=dict)
    route_files: dict = field(default_factory=dict)
    dir_files: dict = field(default_factory=dict)
    schema_files: dict = field(default_factory=dict)
    commit_term_files: dict = field(default_factory=dict)
    commit_term_counts: dict = field(default_factory=dict)

    # derived
    signals: list = field(default_factory=list)
    signal_names: list = field(default_factory=list)
    corroborated: set = field(default_factory=set)
    all_vocab: set = field(default_factory=set)
    vocab_v2: set = field(default_factory=set)
    raw_sig: dict = field(default_factory=dict)
    live_classes: dict = field(default_factory=dict)
    deriv: dict = field(default_factory=dict)
    class_corroborated: set = field(default_factory=set)

    spread: dict = field(default_factory=dict)
    indeg: object = None
    outdeg: object = None
    commits: list = field(default_factory=list)
    co: dict = field(default_factory=dict)
    hh: dict = field(default_factory=dict)
    attribution: dict = field(default_factory=dict)
    contested: list = field(default_factory=list)
    kinds: object = None
    disp: dict = field(default_factory=dict)
    disp_all: dict = field(default_factory=dict)
    comms: list = field(default_factory=list)
    comm_nodes: int = 0
    comm_purity: float = 0.0
    vend_hist: set = field(default_factory=set)
    recur_names: dict = field(default_factory=dict)
    raw_tables: list = field(default_factory=list)
    shared_bucket: list = field(default_factory=list)

    # layout shape - whether directories name features or architectural layers,
    # measured per top-level subtree. See layout.py.
    layout_overall: dict = field(default_factory=dict)
    layout_shapes: dict = field(default_factory=dict)
    feature_dirs: dict = field(default_factory=dict)

    # The mapper's own vocabulary and per-file ownership.
    #
    # These exist because `spread` above is built from `vocab_v2` - the v2
    # CORROBORATED set - and the mapper must not be gated by it. On
    # TaskTrackerGo no signal qualifies under the v2 rule at all, so vocab_v2 is
    # empty and the text signal was silently switched off: every file was placed
    # on commit messages alone. Ranking without gating has to apply to the text
    # signal too, not just to the feature list.
    map_vocab: set = field(default_factory=set)
    map_spread: dict = field(default_factory=dict)
    map_disp: dict = field(default_factory=dict)
    filename_files: dict = field(default_factory=dict)
    # Directory names covering a quarter or more of the repo. Not features, and
    # excluded from the mapper's vocabulary no matter which signal proposed them:
    # "update frontend styling" in a commit subject does not make `frontend` a
    # feature. Kept out of a.dirs_vocab so the reproduction check is unaffected.
    container_terms: set = field(default_factory=set)


def analyze(repo: Path, label=None, exclude=(), keep_vendor=False,
            min_mentions=3, rival_ratio=0.4, drop=(), corroborated_only=True,
            legacy=False) -> Analysis:
    repo = Path(repo).resolve()
    label = label or repo.name

    all_files = source_files(repo)
    if exclude:
        all_files = [f for f in all_files
                     if not any(f == e or f.startswith(e.rstrip("/") + "/")
                                for e in exclude)]
    vendor_path = [f for f in all_files if is_vendor(f)]
    files = all_files if keep_vendor else [f for f in all_files if not is_vendor(f)]
    if not files:
        raise SystemExit("no tracked source files found")

    sqls = sql_files(repo)
    a = Analysis(repo=repo, label=label, files=files, all_files=all_files,
                 vendor_path=vendor_path, sqls=sqls)

    # ---------------------------------------------------- signal: code layout
    page_features = features_from_pages(files)
    route_features = features_from_routes(repo, files)
    dir_features = features_from_dirs(files)
    a.page_files = dict(page_features)
    a.route_files = dict(route_features)
    a.dir_files = dict(dir_features)

    def vocab_of(d):
        return {singular(str(k).lower()) for k in d}

    # ---------------------------------------------------- signal: schema
    cfg_features = features_from_config(repo)
    raw_tables, sqlf, typesf, schemaf = collect_tables(repo, files, sqls,
                                                       all_files, legacy=legacy)
    a.raw_tables = raw_tables
    a.schema_files = dict(schema_file_map(sqlf, typesf, schemaf))

    cfg_vocab = set()
    for names in cfg_features.values():
        cfg_vocab |= {singular(n.lower()) for n in names}

    a.cfg_vocab = {v for v in cfg_vocab if usable(v)}
    a.page_vocab = {v for v in vocab_of(page_features) if usable(v)}
    a.route_vocab = {v for v in vocab_of(route_features) if usable(v)}
    a.schema_vocab_old = {
        v for v in (vocab_of(sqlf) | vocab_of(typesf) | vocab_of(schemaf))
        if usable(v)
    }
    a.schema_vocab_new = {v for v in table_vocab(raw_tables, "head")
                          if len(v) > 3 and v not in STOPWORDS}
    a.dirs_vocab = dir_vocab(files)

    # ------------------------------------------ v2 corroboration (kept for the
    # reproduction check; the mapper ranks instead of gating)
    named = [("config", a.cfg_vocab), ("pages", a.page_vocab),
             ("routes", a.route_vocab), ("schema", a.schema_vocab_old)]
    a.signals = [s for _, s in named if s]
    a.signal_names = [n for n, s in named if s]
    a.corroborated = ({v for v in set().union(*a.signals)
                       if sum(v in s for s in a.signals) >= 2}
                      if len(a.signals) >= 2 else set())
    a.all_vocab = set().union(*a.signals) if a.signals else set()
    vocab_v2 = a.corroborated if (corroborated_only and a.corroborated) else a.all_vocab
    dropped = {d.lower() for d in drop}
    a.vocab_v2 = vocab_v2 - dropped
    a.all_vocab = a.all_vocab - dropped

    # ---------------------------------------------------- signal: history
    a.commits = parse_log(repo, files)
    a.co = cochange_vs_directory(a.commits)
    a.hh = history_health(a.commits, files, a.co)
    cvocab, cterm_counts, cterm_files = commit_vocabulary(a.commits)
    a.commit_vocab = cvocab
    a.commit_term_counts = cterm_counts
    a.commit_term_files = cterm_files
    attribute = commit_attribution_legacy if legacy else commit_attribution
    a.attribution = attribute(cterm_files, cvocab, set(files))

    # ---------------------------------------------------- independence
    a.raw_sig, a.live_classes, a.deriv = signal_classes(
        a.page_vocab, a.route_vocab, a.schema_vocab_new, a.cfg_vocab,
        cvocab, a.dirs_vocab, files)
    if len(a.live_classes) >= 2:
        allv = set().union(*a.live_classes.values())
        a.class_corroborated = {v for v in allv
                                if sum(v in s for s in a.live_classes.values()) >= 2}

    # ---------------------------------------------------- per-file assignment
    det = not legacy
    a.spread = feature_spread(repo, files, a.vocab_v2, min_mentions, rival_ratio,
                              deterministic=det)
    a.indeg = import_indegree(repo, files)
    a.outdeg = outdegree(repo, files)
    a.contested = classify_contested(repo, a.spread, a.outdeg)
    a.kinds = collections.Counter(r["kind"] for r in a.contested)

    threshold = max(3, 0.15 * len(files))
    a.shared_bucket = [t for t, n in a.indeg.items() if n >= threshold]

    a.disp = term_dispersion(a.spread, a.vocab_v2)
    a.disp_all = term_dispersion(
        feature_spread(repo, files, a.all_vocab, min_mentions, rival_ratio,
                       deterministic=det),
        a.all_vocab) if a.all_vocab else {}

    a.comms, a.comm_nodes = cochange_communities(a.co["pair_counts"], files)
    _, a.comm_purity = community_purity(a.comms, a.spread)

    # Layout shape. Computed after the signals so it can filter what the
    # directory signal is allowed to claim, and kept out of the trial-3 row so
    # the reproduction check is unaffected by it.
    a.layout_overall, a.layout_shapes = detect_shapes(files)
    a.container_terms = container_terms(a.dir_files, len(files))
    a.feature_dirs = feature_dir_terms(a.dir_files, a.layout_shapes,
                                       a.layout_overall, len(files))

    # Vendored detection needs the unfiltered file list and the root commit.
    commits_all = log_with_root(repo, all_files)
    a.vend_hist, _ = vendored_by_history(repo, all_files, commits_all, legacy=legacy)

    # The mapper's vocabulary: every term any signal proposed, ungated. The
    # extra text scan costs one more pass over the files, and is what gives a
    # single-signal repo a text signal at all.
    # Filenames normally only confirm (see signals/names). They are allowed to
    # propose when a word recurs across several files in several directories,
    # which is the only signal a layer-first repo with no web layer, no SQL and
    # no usable commit messages has left. Off in legacy mode.
    a.recur_names = {} if legacy else recurring_filename_terms(files)
    a.map_vocab = {t for t in (a.page_vocab | a.route_vocab | a.dirs_vocab
                               | a.schema_vocab_new | a.cfg_vocab | a.commit_vocab
                               | set(a.recur_names))
                   if len(t) > 3 and t not in a.container_terms}
    if a.map_vocab:
        a.map_spread = feature_spread(repo, files, a.map_vocab, min_mentions,
                                      rival_ratio, deterministic=det)
        a.map_disp = term_dispersion(a.map_spread, a.map_vocab)
    # Filenames confirm an already-proposed feature; they never propose one.
    a.filename_files = dict(features_from_filenames(files, a.map_vocab))

    return a


def trial3_row(a: Analysis) -> dict:
    """The measure_v3.py --json row, recomputed from the library."""
    total = len(a.spread)
    multi = sum(1 for v in a.spread.values() if v["rivals"])
    vp, vh = set(a.vendor_path), set(a.vend_hist)
    v_prec = (len(vp & vh) / len(vh)) if vh else 0.0
    v_rec = (len(vp & vh) / len(vp)) if vp else 0.0
    hh, co = a.hh, a.co
    files = a.files
    return {
        "label": a.label, "files": len(files), "vendored_path": len(a.vendor_path),
        "vendored_hist": len(a.vend_hist), "vend_precision": round(v_prec, 3),
        "vend_recall": round(v_rec, 3),
        "sql_files": len(a.sqls), "commits": hh["commits"],
        "usable_commits": hh["usable_commits"], "median_files": hh["median_files"],
        "ai_pct": round(100.0 * hh["ai_commits"] / hh["commits"], 1) if hh["commits"] else 0,
        "cochange_coverage": round(100.0 * hh["covered_files"] / len(files), 1),
        "dir_agreement": round(100.0 * co["same_dir_events"] / co["pair_events"], 1) if co["pair_events"] else 0,
        "signals_v2": len(a.signals), "signal_names": a.signal_names,
        "classes": list(a.live_classes), "n_classes": len(a.live_classes),
        "deriv_routes_from_pages": round(100 * (a.deriv.get("routes<-pages") or 0), 1),
        "deriv_commits_from_layout": round(100 * (a.deriv.get("commits<-layout") or 0), 1),
        "deriv_schema_from_layout": round(100 * (a.deriv.get("schema<-layout") or 0), 1),
        "vocab_v2": len(a.vocab_v2), "vocab_all": len(a.all_vocab),
        "corroborated_v2": len(a.corroborated),
        "corroborated_class": len(a.class_corroborated),
        "multi_pct": round(100.0 * multi / total, 1) if total else 0,
        "aggregator": a.kinds["aggregator"], "split_logic": a.kinds["split-logic"],
        "unclear": a.kinds["unclear"],
        "aggregator_pct": round(100.0 * a.kinds["aggregator"] / total, 1) if total else 0,
        "split_logic_pct": round(100.0 * a.kinds["split-logic"] / total, 1) if total else 0,
        "shared_bucket": len(a.shared_bucket),
        "tables_raw": len(set(a.raw_tables)),
        "tables_old_rule": len(table_vocab(a.raw_tables, "old")),
        "tables_head_rule": len(a.schema_vocab_new),
        "commit_vocab": len(a.commit_vocab),
        "commit_attributed": len(a.attribution),
        "commit_attributed_pct": round(100.0 * len(a.attribution) / len(files), 1) if files else 0,
        "commit_only_terms": len(a.commit_vocab - a.all_vocab),
        "communities": sum(1 for c in a.comms if len(c) >= 3),
        "community_nodes": a.comm_nodes,
        "community_purity": round(100 * a.comm_purity, 1),
        "single_file_terms": len([t for t, d in (a.disp_all or a.disp).items() if d["files"] <= 1]),
        "vocab_disp_total": len(a.disp_all or a.disp),
    }
