"""
Signal class: history (co-change).

Which files get edited together, and whether that is worth listening to.

`history_health` is the gate, and it has to run first. Trial 3 corrected the
pilot here: co-change coverage is 6.7-100% (median 80.3%), not uniformly
healthy. On a repo where 12 commits each touch 400 files, every pair of files
"co-changes" and the signal is pure noise; on a repo where most commits touch
one file, there are no pairs at all. A file that never appears in a usable
commit can never be placed by co-change no matter how good the algorithm is, so
the mapper must read `coverage` before weighting this signal.
"""

import collections
import itertools
import os
import re
import statistics

AI_MARKERS = re.compile(
    r"claude|lovable|cursor|copilot|bolt\.new|codex|gpt-|devin|windsurf|\[skip lovable\]",
    re.IGNORECASE,
)


def cochange_vs_directory(commits, max_files_per_commit=30):
    """
    Do files edited in the same commit live in the same folder? If yes, the
    cheapest signal (folders) already captures what git history knows.
    """
    pair_counts = collections.Counter()
    skipped_large = 0
    for c in commits:
        files = sorted(set(c["files"]))
        if len(files) < 2:
            continue
        if len(files) > max_files_per_commit:
            skipped_large += 1
            continue
        for a, b in itertools.combinations(files, 2):
            pair_counts[(a, b)] += 1

    same_dir = sum(
        n for (a, b), n in pair_counts.items()
        if os.path.dirname(a) == os.path.dirname(b)
    )
    total = sum(pair_counts.values())
    return {
        "commits": len(commits),
        "skipped_large": skipped_large,
        "pairs": len(pair_counts),
        "pair_events": total,
        "same_dir_events": same_dir,
        "agreement": (same_dir / total) if total else 0.0,
        "top_pairs": pair_counts.most_common(15),
        "pair_counts": pair_counts,
    }


def history_health(commits, files, co, max_files_per_commit=30):
    """
    Is co-change usable on this repo at all?

    The signal degrades in two distinct ways, and they need separating:

      too big  - a commit touching 400 files pairs everything with everything,
                 so it is noise, not evidence. Excluded by the same 30-file cap
                 cochange_vs_directory already uses.
      too small- a commit touching one file yields no pair at all, so it
                 contributes nothing either.

    What is left is the usable history. `coverage` then asks the question that
    actually decides the design: what share of the source files ever appear in
    a usable commit?
    """
    sizes = [len(set(c["files"])) for c in commits]
    nonempty = [s for s in sizes if s > 0]
    usable = [c for c in commits if 2 <= len(set(c["files"])) <= max_files_per_commit]
    single = sum(1 for s in nonempty if s == 1)
    huge = sum(1 for s in nonempty if s > max_files_per_commit)

    covered = set()
    for c in usable:
        covered.update(c["files"])

    ai = sum(1 for c in commits
             if AI_MARKERS.search(c["subject"]) or AI_MARKERS.search(c["author"])
             or AI_MARKERS.search(c["email"]))

    # How concentrated is co-change? If a handful of pairs carry most events,
    # the signal is really only speaking about a small corner of the repo.
    pc = co["pair_counts"]
    strong = [p for p, n in pc.items() if n >= 3]

    return {
        "commits": len(commits),
        "commits_touching_source": len(nonempty),
        "single_file_commits": single,
        "huge_commits": huge,
        "usable_commits": len(usable),
        "median_files": statistics.median(nonempty) if nonempty else 0,
        "mean_files": (sum(nonempty) / len(nonempty)) if nonempty else 0,
        "p90_files": (statistics.quantiles(nonempty, n=10)[-1]
                      if len(nonempty) > 9 else (max(nonempty) if nonempty else 0)),
        "max_files": max(nonempty) if nonempty else 0,
        "covered_files": len(covered & set(files)),
        "coverage": (len(covered & set(files)) / len(files)) if files else 0.0,
        "ai_commits": ai,
        "strong_pairs": len(strong),
    }


def cochange_communities(pair_counts, files, min_weight=2, rounds=12):
    """
    A feature list built from nothing but git history - no filenames, no route
    table, no schema, no vocabulary. Label propagation over the co-change
    graph, keeping only pairs seen at least twice so one-off edits do not fuse
    everything into a single blob.

    DETERMINISM FIX (the known v4 defect). Label propagation visited nodes in
    `adj` insertion order and broke ties via Counter.most_common, so the
    communities - and therefore M10c purity - moved between runs. Nodes are now
    visited in sorted order and ties break on the smallest label, making the
    partition reproducible for a given input.
    """
    adj = collections.defaultdict(dict)
    for (a, b), n in sorted(pair_counts.items()):
        if n < min_weight:
            continue
        adj[a][b] = n
        adj[b][a] = n
    nodes = sorted(adj)
    label = {n: i for i, n in enumerate(nodes)}
    for _ in range(rounds):
        changed = 0
        for n in nodes:
            tally = collections.Counter()
            for m, w in adj[n].items():
                tally[label[m]] += w
            if tally:
                best = max(tally.values())
                top = min(l for l, w in tally.items() if w == best)
                if top != label[n]:
                    label[n] = top
                    changed += 1
        if not changed:
            break
    comms = collections.defaultdict(list)
    for n, l in sorted(label.items()):
        comms[l].append(n)
    return sorted(comms.values(), key=lambda c: (-len(c), c[0])), len(nodes)


def community_purity(comms, spread):
    """Do the history-only clusters agree with the vocabulary-assigned owner?"""
    scored = []
    for c in comms:
        owners = collections.Counter(
            spread[f]["owner"] for f in c if f in spread and spread[f]["owner"]
        )
        if not owners:
            scored.append((len(c), None, 0.0))
            continue
        top, n = owners.most_common(1)[0]
        scored.append((len(c), top, n / sum(owners.values())))
    sized = [(s, t, p) for s, t, p in scored if s >= 3]
    weighted = (sum(s * p for s, _, p in sized) / sum(s for s, _, p in sized)) if sized else 0.0
    return scored, weighted
