"""
/map - produce a feature -> files map for a git repository.

    python -m tools.map.map <repo> [--top N] [--exclude DIR] [--drop TERM]
                            [-o OUTDIR] [--label NAME]

Writes five files:

    map-<label>.md        human review sheet, ranked, evidence shown
    map-<label>.json      full result including buckets and rivals
    feature_files-<label>.csv   feature_name,file_path,confidence
    canvas-<label>.md     the same map in the format FeaturePlus's dependency
                          canvas reads, so it can be opened and looked at
    features-<label>.md   feature names only, for the playground to review
                          and import

The CSV is the shape FeaturePlus's `feature_files` table wants, because that is
what the map is *for*: the mapping that currently has to be typed in by hand
before scoped contracts can serve a collaborator anything.

This is a draft for a human to correct, not an answer. Everything it emits
carries a confidence and the evidence behind it, and the buckets below are
reported rather than silently dropped, so a reviewer can see what the tool
refused to guess about.

Read-only: nothing is written into the target repo and no model is called.
Turning these raw terms into good feature names ("booking" + "reserve" ->
"Booking") is a separate, later step.
"""

import argparse
import collections
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.map.canvas import (MAX_NEEDS_PER_FEATURE,  # noqa: E402
                              MIN_IMPORTING_FILES, write_canvas_markdown,
                              write_features_markdown)
from tools.map.classify import file_profile, plumbing_files  # noqa: E402
from tools.map.pipeline import analyze  # noqa: E402
from tools.map.repo import is_vendor, pct  # noqa: E402
from tools.map.scoring import (NEEDS_REVIEW_BELOW, assign_files,  # noqa: E402
                               candidate_terms, score_features)


def bucket_files(a):
    """
    Files that should not be attributed to any single feature.

    plumbing   - holds the app together rather than implementing any of it:
                 hub files half the codebase imports, build config, wiring
                 directories, entry points. Without this bucket they land on
                 whichever feature a nearby commit happened to mention.
    vendored   - library code that happens to be committed. Detected from
                 history (bulk-added directory) or by path.
    aggregator - wiring: nav bars, routers, sitemaps. Names every feature
                 because that is its job. Trial 3 showed these are most of what
                 made the multi-feature number look alarming, and that handing
                 one over whole is harmless.
    content    - static prose pages: a page file with almost no logic and
                 almost no links. Trial 3 asked for this bucket explicitly;
                 without it, About/Privacy/Terms pages get attributed to
                 whichever feature word happens to appear in their copy.
    """
    buckets = {}
    for f in set(a.vend_hist) | {f for f in a.all_files if is_vendor(f)}:
        if f in set(a.files):
            buckets[f] = "vendored"
    for r in a.contested:
        if r["kind"] == "aggregator":
            buckets.setdefault(r["file"], "aggregator")
    for f, kind in plumbing_files(a).items():
        buckets.setdefault(f, kind)

    for f in a.files:
        if f in buckets:
            continue
        p = file_profile(a.repo, f, a.outdeg.get(f, 0))
        is_page = any(seg in ("pages", "views", "screens", "app")
                      for seg in f.split("/")[:-1])
        if is_page and p["lines"] >= 20 and p["logic"] == 0 and p["link_d"] < 1.0:
            buckets[f] = "content"
    return buckets


def build(a, top=None, min_score=0.0):
    terms = candidate_terms(a)
    ranked = score_features(a, terms)
    kept = [r for r in ranked if r["score"] >= min_score]
    if top:
        kept = kept[:top]
    # Ranked and shown is not the same as allowed to claim files. A muted word
    # (`email`, `handler`) or a word only one file ever mentions (`login`) stays
    # in the ranking with its reason attached, but never becomes a row - and
    # because it does not vote, a real feature can win the file instead.
    keep_terms = {r["term"] for r in kept if r["claims"]}

    buckets = bucket_files(a)
    voted = assign_files(a, keep_terms)
    # A bucketed file is described, not attributed.
    voted = {f: v for f, v in voted.items() if f not in buckets}

    # Split off the guesses too weak to put in the map. They are kept and
    # reported - the reviewer needs to see them - but they do not become rows.
    assigned = {f: v for f, v in voted.items()
                if v["confidence"] >= NEEDS_REVIEW_BELOW}
    needs_review = {f: v for f, v in voted.items()
                    if v["confidence"] < NEEDS_REVIEW_BELOW}

    by_feature = collections.defaultdict(list)
    for f, v in assigned.items():
        by_feature[v["feature"]].append((f, v))

    for r in kept:
        rows = sorted(by_feature.get(r["term"], []))
        r["files"] = [
            {"path": f, "confidence": v["confidence"], "margin": v["margin"],
             "evidence": v["evidence"]}
            for f, v in rows
        ]
        r["file_count"] = len(rows)

    unassigned = [f for f in a.files
                  if f not in voted and f not in buckets]
    return kept, ranked, assigned, buckets, unassigned, needs_review


def write_markdown(a, kept, ranked, assigned, buckets, unassigned, needs_review,
                   out: Path):
    bc = collections.Counter(buckets.values())
    L = []
    w = L.append
    w(f"# Feature map - {a.label}")
    w("")
    w(f"**Repo:** `{a.repo}`  ")
    w(f"**Source files:** {len(a.files)}  ")
    w(f"**Commits:** {a.hh['commits']} ({a.hh['usable_commits']} usable)  ")
    w(f"**Co-change coverage:** {pct(a.hh['covered_files'], len(a.files))}  ")
    lo = a.layout_overall
    w(f"**Layout:** {lo['shape']} "
      f"(layerness {lo['layerness']:.2f}, generic filenames {lo['genericness']:.2f})  ")
    w("")
    multi = {s["shape"] for s in a.layout_shapes.values()}
    if len(a.layout_shapes) > 1 and len(multi) > 1:
        w("Per-subtree layout (directory names are only read as features where "
          "the layout says they mean features):")
        w("")
        w("| Subtree | Files | Shape | Layerness | Generic filenames |")
        w("|---|---:|---|---:|---:|")
        for sub, s in sorted(a.layout_shapes.items(),
                             key=lambda kv: -kv[1]["files"]):
            w(f"| `{sub}` | {s['files']} | {s['shape']}"
              + (" _(inherited)_" if s.get("inherited") else "")
              + f" | {s['layerness']:.2f} | {s['genericness']:.2f} |")
        w("")
    w("> Draft for review. Every row carries the evidence behind it. Features "
      "are ranked, never dropped - a weak one sinks to the bottom rather than "
      "disappearing before you see it.")
    w("")

    # Health warnings a reviewer needs before trusting anything below.
    warn = []
    if a.hh["commits"] < 20:
        warn.append(f"Only {a.hh['commits']} commits - the strongest signal is weak here.")
    if a.hh["coverage"] < 0.4:
        warn.append(f"Co-change coverage is {100*a.hh['coverage']:.0f}% - "
                    "most files never appear in a usable commit.")
    if len(a.live_classes) < 2:
        warn.append(f"Only {len(a.live_classes)} signal class present "
                    f"({', '.join(a.live_classes) or 'none'}) - nothing corroborates anything.")
    if warn:
        w("## Read this first")
        w("")
        for x in warn:
            w(f"- **{x}**")
        w("")

    w("## Features")
    w("")
    w("| # | Feature | Score | Files | Evidence |")
    w("|---:|---|---:|---:|---|")
    for r in kept:
        if not r["claims"]:
            continue
        w(f"| {r['rank']} | **{r['term']}** | {r['score']:.2f} | {r['file_count']} | "
          f"{', '.join(r['evidence'])} |")
    w("")

    not_features = [r for r in kept if not r["claims"]]
    if not_features:
        w("### Considered and not used")
        w("")
        w("_Ranked, but not allowed to own files. Shown so you can overrule it._")
        w("")
        w("| Term | Score | Why not |")
        w("|---|---:|---|")
        for r in not_features:
            why = ("names something the app does, not something it is about"
                   if r["muted"] else "only one file in the repo mentions it")
            w(f"| `{r['term']}` | {r['score']:.2f} | {why} |")
        w("")

    w("## File assignments")
    w("")
    for r in kept:
        if not r["files"]:
            continue
        w(f"### {r['term']}  _(score {r['score']:.2f}, {r['file_count']} files)_")
        w("")
        w("| File | Confidence | Margin | Why |")
        w("|---|---:|---:|---|")
        for fr in r["files"]:
            w(f"| `{fr['path']}` | {fr['confidence']:.2f} | {fr['margin']:.2f} | "
              f"{', '.join(fr['evidence'])} |")
        w("")

    w("## Not attributed")
    w("")
    w("_Reported rather than dropped, so you can see what the tool refused to guess._")
    w("")
    w("| Bucket | Files | Meaning |")
    w("|---|---:|---|")
    w(f"| needs review | {len(needs_review)} | a feature was suggested, but the evidence is too thin to assert it. |")
    w(f"| plumbing | {bc['plumbing']} | serves the whole app; belongs to no one feature. |")
    w(f"| aggregator | {bc['aggregator']} | wiring: nav, router, sitemap. Safe to hand over whole. |")
    w(f"| content | {bc['content']} | static prose pages. |")
    w(f"| vendored | {bc['vendored']} | library code that happens to be committed. |")
    w(f"| unassigned | {len(unassigned)} | no signal had an opinion at all. |")
    w("")
    if needs_review:
        w(f"### Needs review ({len(needs_review)})")
        w("")
        w(f"_Best guess shown, but below the {NEEDS_REVIEW_BELOW:.2f} confidence floor. "
          "Deliberately kept out of the map._")
        w("")
        w("| File | Best guess | Confidence | Why |")
        w("|---|---|---:|---|")
        for f, v in sorted(needs_review.items(), key=lambda kv: -kv[1]["confidence"]):
            w(f"| `{f}` | {v['feature']} | {v['confidence']:.2f} | "
              f"{', '.join(v['evidence'])} |")
        w("")
    if unassigned:
        w("Unassigned files:")
        w("")
        for f in unassigned[:40]:
            w(f"- `{f}`")
        if len(unassigned) > 40:
            w(f"- _...and {len(unassigned) - 40} more_")
        w("")

    low = sorted((v["confidence"], f) for f, v in assigned.items() if v["confidence"] < 0.35)
    if low:
        w("## Lowest-confidence assignments (check these first)")
        w("")
        for c, f in low[:25]:
            w(f"- `{f}` -> **{assigned[f]['feature']}** ({c:.2f}, "
              f"{', '.join(assigned[f]['evidence'])})")
        w("")

    dropped = [r for r in ranked if r not in kept]
    if dropped:
        w(f"## Below the cut ({len(dropped)} terms)")
        w("")
        w(", ".join(f"`{r['term']}`({r['score']:.2f})" for r in dropped[:60]))
        w("")

    out.write_text("\n".join(L), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repo")
    ap.add_argument("--label", default=None)
    ap.add_argument("-o", "--outdir", default=None)
    ap.add_argument("--top", type=int, default=None,
                    help="keep only the N best-ranked features")
    ap.add_argument("--min-score", type=float, default=0.0)
    ap.add_argument("--exclude", action="append", default=[])
    ap.add_argument("--drop", action="append", default=[])
    ap.add_argument("--min-importing-files", type=int,
                    default=MIN_IMPORTING_FILES,
                    help="canvas arrows: how many of a feature's files must "
                         "import another feature before the arrow is drawn")
    ap.add_argument("--max-needs", type=int, default=MAX_NEEDS_PER_FEATURE,
                    help="canvas arrows: most dependencies to draw per feature")
    ap.add_argument("--min-mentions", type=int, default=3)
    ap.add_argument("--rival-ratio", type=float, default=0.4)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    repo = Path(args.repo).resolve()
    if not (repo / ".git").exists():
        sys.exit(f"not a git repository: {repo}")
    label = args.label or repo.name
    outdir = Path(args.outdir) if args.outdir else Path.cwd()
    outdir.mkdir(parents=True, exist_ok=True)

    a = analyze(repo, label=label, exclude=args.exclude, drop=args.drop,
                min_mentions=args.min_mentions, rival_ratio=args.rival_ratio,
                legacy=False)
    kept, ranked, assigned, buckets, unassigned, needs_review = build(
        a, args.top, args.min_score)

    md = outdir / f"map-{label}.md"
    write_markdown(a, kept, ranked, assigned, buckets, unassigned, needs_review, md)

    js = outdir / f"map-{label}.json"
    js.write_text(json.dumps({
        "label": label, "repo": str(repo),
        "files": len(a.files), "commits": a.hh["commits"],
        "signal_classes": list(a.live_classes),
        "features": kept,
        "buckets": buckets,
        "unassigned": unassigned,
        "needs_review": needs_review,
        "below_cut": [r["term"] for r in ranked if r not in kept],
        "not_used": [{"term": r["term"], "score": r["score"],
                      "muted": r["muted"], "one_file": r["one_file"]}
                     for r in ranked if not r["claims"]],
    }, indent=1), encoding="utf-8")

    # One CSV, with a status column. Needs-review rows are carried rather than
    # dropped so nothing disappears silently, but they are marked so an import
    # can filter them out.
    csvp = outdir / f"feature_files-{label}.csv"
    with csvp.open("w", newline="", encoding="utf-8") as fh:
        wr = csv.writer(fh)
        wr.writerow(["feature_name", "file_path", "confidence", "status", "evidence"])
        for r in kept:
            for fr in r["files"]:
                wr.writerow([r["term"], fr["path"], fr["confidence"], "confident",
                             "; ".join(fr["evidence"])])
        for f, v in sorted(needs_review.items()):
            wr.writerow([v["feature"], f, v["confidence"], "needs_review",
                         "; ".join(v["evidence"])])

    canvas = outdir / f"canvas-{label}.md"
    edge_stats = write_canvas_markdown(a, kept, assigned, unassigned, canvas,
                                       min_files=args.min_importing_files,
                                       max_needs=args.max_needs)
    features_md = outdir / f"features-{label}.md"
    write_features_markdown(a, kept, features_md)

    if not args.quiet:
        bc = collections.Counter(buckets.values())
        print(f"[{label}] {len(a.files)} files, {a.hh['commits']} commits, "
              f"classes={len(a.live_classes)}")
        print(f"  features kept: {len(kept)} of {len(ranked)} candidates")
        print(f"  files assigned: {len(assigned)} ({pct(len(assigned), len(a.files))}) "
              f"| needs review {len(needs_review)} | aggregator {bc['aggregator']} "
              f"| content {bc['content']} | vendored {bc['vendored']} "
              f"| unassigned {len(unassigned)}")
        print(f"  top: " + ", ".join(f"{r['term']}({r['file_count']})" for r in kept[:8]))
        # Where the arrows came from, and what the imports could not say. "No
        # arrows" has two very different causes and the reviewer needs to know
        # which one this run hit.
        print(f"  canvas arrows: {edge_stats['edges']} from "
              f"{edge_stats['crossing']} crossing imports of "
              f"{edge_stats['pairs']} total "
              f"(within a feature {edge_stats['within_feature']}, "
              f"unattributed source {edge_stats['source_unattributed']}, "
              f"unattributed target {edge_stats['target_unattributed']}, "
              f"below threshold {edge_stats['below_threshold']}, "
              f"capped {edge_stats['capped']})")
        print(f"  -> {md}")
        print(f"  -> {csvp}")
        print(f"  -> {canvas}   (open this in the dependency canvas)")
        print(f"  -> {features_md}   (open this in the playground)")


if __name__ == "__main__":
    main()
