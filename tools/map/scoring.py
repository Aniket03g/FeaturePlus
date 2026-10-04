"""
Ranking features, and assigning files to them.

This module is the actual change of purpose from the trial: the measurement
passes computed how *much* of a repo the signals could explain, and threw the
explanation away. Here the explanation is the product.

Two decisions from trial 3 are baked in.

RANK, DO NOT GATE. v2's rule was "a term named by two signals is real, anything
else is discarded". It inverted on the vibecoded sample, because pages and
routes turned out to be one signal counted twice, and on Next.js App Router it
returned nothing at all - a gate that fails closed hands back an empty map and
the user learns nothing. Every candidate term is therefore scored and sorted,
never dropped. A weak term sinks to the bottom of the list where a human can
ignore it; it does not vanish before the human sees it.

COMMITS LEAD. Commit vocabulary attributed 43-97% of files directly, is
independent of code layout by construction, and named features on `rido` that no
code signal saw. So it carries the largest weight both in ranking a feature and
in assigning a file. Its known weakness - it needs history to exist - is handled
by falling back to the other sources per file rather than by disqualifying it.
"""

import collections
import math
from pathlib import Path

from .layout import dirname_multiplier, is_role_word
from .vocab import singular, split_name

# The ceiling each source can reach when assigning one file to one feature.
#
# Commits and in-file text share the top ceiling, which is a correction. The
# trial's finding that commits are the strongest signal is about *naming*
# features - which it is, and score_features still reflects it. Assigning a
# specific file is a different question, and there in-file text is at least as
# direct: a commit note describes a batch of files, while 168 occurrences of
# "lead" inside leads.astro describe that one file. With commits capped higher,
# perfect text evidence could never beat weak commit evidence, which is exactly
# how `leads.astro` (168 text mentions of `lead`) ended up under `admin` on two
# commit mentions.
#
# Directory names stay low - a file under app/bookings/ is probably a booking
# file, but nesting lies - and a schema declaration is narrow: strong evidence
# about the declaring file only.
SOURCE_WEIGHTS = {
    "commits": 0.45,
    "text": 0.45,
    "filename": 0.35,
    "dirname": 0.15,
    "schema": 0.05,
}

# Below this, an assignment is not put in the map. It goes to a needs-review
# list instead. A wrong answer is worse than no answer here: the whole point of
# the output is that a human corrects it, and a file asserted at the same
# confidence as a well-evidenced one hides the fact that nobody actually knows.
#
# 0.30 is chosen so that ONE source has to be genuinely strong to carry a file
# alone - it needs strength 0.67, which on Grove means about 3 commit mentions
# or about 22 text mentions - while two sources agreeing at ordinary strength
# clear it comfortably. That is the rule stated plainly: three dedicated
# mentions, or a lot of text, or two different kinds of evidence agreeing.
NEEDS_REVIEW_BELOW = 0.30

# How much a prose vote is worth when the file's own name names a different
# feature. See assign_files.
TEXT_VS_FILENAME = 0.5

# Weights for ranking a candidate feature. Class agreement dominates because
# trial 3's whole correction was that cross-class agreement is the only kind
# that means anything.
RANK_WEIGHTS = {
    "classes": 2.0,     # independent signal classes naming it (max 3)
    "commits": 1.5,     # commit subjects mentioning it
    "owned": 1.0,       # files it dominates by text
    "table": 0.75,      # declared in the data model
    "dirname": 0.75,    # has a directory named after it
    "filename": 0.75,   # its name recurs across files in several directories
}
RANK_MAX = sum(RANK_WEIGHTS.values())


def table_terms(a):
    """Terms the repository declares in its data model."""
    return a.schema_vocab_new | a.cfg_vocab


def muted_terms(a, terms):
    """
    Terms that may not claim a file on the strength of the file tree or the
    prose inside it.

    Two kinds are muted: architectural role words (`handler`, `model`) and
    capability words (`email`, `export`) - see layout.py for why each set is
    what it is. Both describe something true about a file that is not what the
    file is *about*.

    A declared table lifts the mute, and that single exception is what keeps the
    rule from being a blacklist. A crypto app with a `tokens` table, or a mail
    client with an `emails` table, has said in its own schema that the word names
    an entity; then it can claim files like any other feature. Muting only bites
    when the file tree and the prose are the only things saying the word.
    """
    tables = table_terms(a)
    return {t for t in terms if is_role_word(t) and t not in tables}


def support_files(a, term):
    """Every file that is a reason this term was proposed at all."""
    out = set()
    for src in (a.page_files, a.route_files, a.feature_dirs, a.schema_files,
                a.commit_term_files, a.filename_files):
        out |= set(src.get(term, ()))
    for f, v in (a.map_spread or a.spread).items():
        if v.get("owner") == term:
            out.add(f)
    return out


def one_file_terms(a, terms):
    """
    Terms whose entire existence is one file - usually that file's own name.

    On Grove `login`, `callback`, `change` and `credential` each entered the
    vocabulary because a page is named after them, then confirmed themselves
    with the same filename, then claimed that one file. The evidence is a
    circle: the term exists because of the file and the file is assigned because
    of the term. Nothing outside that one file ever mentions it.

    A real feature leaves marks in more than one place - `auth` on Grove scores
    no better than these, but it has a directory, two handlers in different
    layers and commit traffic, so it survives this rule while they do not. That
    is the difference the raw score could not see.

    A declared table is exempt: a schema entry is independent evidence that the
    word names something real, even when only one file implements it yet.
    """
    tables = table_terms(a)
    return {t for t in terms
            if t not in tables and len(support_files(a, t)) <= 1}


def candidate_terms(a):
    """
    Every term any signal proposed, with no filtering.

    Deliberately the union and not the corroborated set - see the module
    docstring. Filtering happens by rank, downstream, where it is visible.
    """
    return set(a.map_vocab)


def score_features(a, terms):
    """
    Rank candidate features by how much independent evidence supports them.

    Returns rows sorted best-first, each carrying the evidence that produced the
    score so a reviewer can see why a feature is where it is rather than being
    handed a bare number.
    """
    # Only directories that actually look like features count as evidence. In a
    # layer-first subtree `handlers/` is architecture, not a feature, and a role
    # word like `model` earns nothing from the file tree anywhere. See layout.py.
    dir_terms = set(a.feature_dirs)
    # Filename recurrence, when it was allowed to propose. Weighted like a
    # directory name because it is the same kind of claim - the file tree saying
    # what a thing is - but it survives a layer-first repo, where the directories
    # are architecture and only the filenames carry features.
    recur = getattr(a, "recur_names", {}) or {}
    tables = table_terms(a)
    disp = a.map_disp or a.disp_all or a.disp

    muted = muted_terms(a, terms)
    circular = one_file_terms(a, terms)

    rows = []
    for t in sorted(terms):
        role = is_role_word(t)
        classes = sum(1 for v in a.live_classes.values() if t in v)
        if role and classes:
            # Its presence in the file tree is explained by architecture, so the
            # code-layout class is not independent evidence for it. Schema and
            # history credit are untouched - that is what lets a genuine `token`
            # feature in a crypto app still rank on its table and its commits.
            classes = sum(1 for name, v in a.live_classes.items()
                          if t in v and name != "code-layout")
        commits = a.commit_term_counts.get(t, 0)
        owned = disp.get(t, {}).get("owned", 0)
        attributed = sum(1 for _, (term, _) in a.attribution.items() if term == t)

        raw = (
            RANK_WEIGHTS["classes"] * min(classes, 3) / 3
            + RANK_WEIGHTS["commits"] * min(commits, 20) / 20
            + RANK_WEIGHTS["owned"] * min(owned, 10) / 10
            + RANK_WEIGHTS["table"] * (1.0 if t in tables else 0.0)
            + RANK_WEIGHTS["dirname"] * (1.0 if t in dir_terms else 0.0)
            + RANK_WEIGHTS["filename"] * (1.0 if t in recur else 0.0)
        )
        # An architectural role word can still be a genuine feature - `token` in
        # a crypto app, `payment` nowhere near this list - but it needs evidence
        # from outside both the file tree and commit chatter, and a declaration
        # in the data model is exactly that. Without one it is halved, so it
        # sinks below real features while staying visible in the ranking.
        if role and t not in tables:
            raw *= 0.5

        evidence = []
        if classes:
            evidence.append(f"{classes} signal class{'es' if classes > 1 else ''}")
        if commits:
            evidence.append(f"commits({commits})")
        if t in tables:
            evidence.append("declared table")
        if t in dir_terms:
            evidence.append(f"dir({len(a.feature_dirs[t])} files)")
        if t in recur:
            nf, nd = recur[t]
            evidence.append(f"named in {nf} files across {nd} dirs")
        if owned:
            evidence.append(f"owns {owned} files by text")
        if role:
            evidence.append("architectural role word - no file-tree credit")
        if t in circular:
            evidence.append("only one file mentions it")

        rows.append({
            "term": t,
            "score": round(raw / RANK_MAX, 3),
            "classes": classes,
            "commits": commits,
            "owned": owned,
            "attributed": attributed,
            "is_table": t in tables,
            "is_dir": t in dir_terms,
            "is_recurring_name": t in recur,
            "is_role_word": role,
            # Whether this term is allowed to claim files. Ranking still shows
            # it - the reviewer should see that the tool considered `email` and
            # why it did not use it - but it does not become a row in the map.
            "claims": t not in muted and t not in circular,
            "muted": t in muted,
            "one_file": t in circular,
            "evidence": evidence,
        })
    rows.sort(key=lambda r: (-r["score"], r["term"]))
    for i, r in enumerate(rows, 1):
        r["rank"] = i
    return rows


def _p90(values):
    """90th percentile, floored at 1. Same formula used to survey the repos."""
    if not values:
        return None
    s = sorted(values)
    return max(1, s[min(len(s) - 1, int(0.90 * len(s)))])


def evidence_scales(a):
    """
    What counts as strong evidence *in this repository*.

    A fixed threshold cannot work. Grove's best-evidenced file has 16 commit
    mentions; Task Tracker's has 3. "Full marks at 8 mentions" would be
    reasonable for the first and would flatten the second to nothing. So each
    source is graded against the repo's own 90th percentile: full marks means
    as much evidence as the best-evidenced tenth of files here.

    `None` means the source produced no evidence at all in this repo, in which
    case it never votes and the scale is irrelevant.
    """
    return {
        "commits": _p90([n for _, (_t, n) in a.attribution.items()]),
        "text": _p90([v["owner_n"] for v in (a.map_spread or a.spread).values()
                      if v.get("owner")]),
    }


def _strength(n, scale):
    """
    Evidence strength 0..1, saturating at the repo's full-marks level.

    Logarithmic, not linear, and the difference matters enormously. Half of
    Grove's files are assigned on a single commit mention, and the full-marks
    level is 5 - so linear grading scored the typical file 0.2 and, with a
    confidence floor on top, deleted two thirds of the map. A single deliberate
    mention is weak evidence, not no evidence.

    Log grading keeps the ordering (16 beats 5 beats 2 beats 1) while leaving a
    lone mention worth roughly 0.4 rather than 0.2. The gap that matters - one
    passing reference versus a file's whole history - is preserved either way.
    """
    if not scale:
        return 1.0
    return min(1.0, math.log1p(n) / math.log1p(scale))


def assign_files(a, keep_terms):
    """
    Assign each file to one feature by weighted vote across the four sources.

    Each source that has an opinion about a file votes for one term with its
    weight from SOURCE_WEIGHTS; the term with the most weight wins and the
    winning weight is the confidence. A file every source agrees on scores 1.0;
    a file only a directory name speaks for scores 0.15, which is exactly the
    signal that it needs a human eye.

    `margin` is reported alongside because a 0.5 win over a 0.45 rival is a very
    different thing from a 0.5 win over nothing, and the number alone hides that.
    """
    votes = collections.defaultdict(lambda: collections.defaultdict(float))
    sources = collections.defaultdict(lambda: collections.defaultdict(list))
    scales = evidence_scales(a)

    # What each file's own name says it is about. Used below to settle the case
    # where the name and the prose disagree.
    name_terms = collections.defaultdict(set)
    for term, fs in a.filename_files.items():
        if term in keep_terms:
            for f in fs:
                name_terms[f].add(term)

    # 1. commit attribution: file -> the term whose commits touched it most,
    #    weighted by HOW MUCH that term was mentioned. One passing mention in a
    #    note that also touched this file is not the same as sixteen.
    for f, (term, n) in a.attribution.items():
        if term in keep_terms:
            s = _strength(n, scales["commits"])
            votes[f][term] += SOURCE_WEIGHTS["commits"] * s
            sources[f][term].append(f"commits({n})")

    # 2. text ownership: the dominant term by mention count, likewise weighted
    #    by count rather than flat. This is what lets 168 mentions of `lead`
    #    outrank 2 commit mentions of `admin`.
    #
    #    When the file's own name names a DIFFERENT feature, the prose vote is
    #    halved. A name is a claim about what the file is; the words inside it
    #    include everything it merely uses. `lead-detail.astro` mentions
    #    "account" more often than "lead" - because a lead has an account - and
    #    on raw counts that was enough to file it under account. Halving is
    #    deliberately not silencing: overwhelming prose can still win, which is
    #    what should happen to a file whose name has gone stale.
    for f, v in (a.map_spread or a.spread).items():
        term = v.get("owner")
        if term and term in keep_terms:
            s = _strength(v["owner_n"], scales["text"])
            w = SOURCE_WEIGHTS["text"] * s
            note = f"text({v['owner_n']})"
            if name_terms[f] and term not in name_terms[f]:
                w *= TEXT_VS_FILENAME
                note += " [name disagrees]"
            votes[f][term] += w
            sources[f][term].append(note)

    # 3. directory name. Deepest matching directory wins - src/features/billing/
    #    beats src/ - and a file votes once however many ancestors match.
    #    Tokenised the same way as features_from_dirs so `TaskComments/` and
    #    `task-comments/` behave identically.
    # 3. the file's own name, confirming a feature some other signal proposed.
    #    Not scaled: a filename either names the feature or it does not.
    for term, fs in a.filename_files.items():
        if term not in keep_terms:
            continue
        for f in fs:
            votes[f][term] += SOURCE_WEIGHTS["filename"]
            sources[f][term].append("filename")

    # 4. directory name.
    #    The vote is scaled by the subtree's layout shape: silenced entirely in a
    #    layer-first subtree, where the directory names the layer and says nothing
    #    about which feature the file serves.
    for f in a.files:
        mult = dirname_multiplier(a.layout_shapes, a.layout_overall, f)
        if mult <= 0:
            continue
        parts = Path(f).parent.parts
        best = None
        for depth, part in enumerate(parts):
            for raw in split_name(part):
                term = singular(raw)
                if term in keep_terms:
                    best = (depth, part, term)
        if best:
            depth, part, term = best
            votes[f][term] += SOURCE_WEIGHTS["dirname"] * mult
            sources[f][term].append(f"dir({part})")

    # 4. schema declaration: the file that declares the table is that feature's
    for term, decl_files in a.schema_files.items():
        if term not in keep_terms:
            continue
        for f in set(decl_files):
            votes[f][term] += SOURCE_WEIGHTS["schema"]
            sources[f][term].append("declares table")

    out = {}
    for f in a.files:
        if f not in votes or not votes[f]:
            continue
        ranked = sorted(votes[f].items(), key=lambda kv: (-kv[1], kv[0]))
        term, weight = ranked[0]
        runner = ranked[1][1] if len(ranked) > 1 else 0.0
        out[f] = {
            "feature": term,
            "confidence": round(min(weight, 1.0), 3),
            "margin": round(weight - runner, 3),
            "evidence": sources[f][term],
            "rivals": [{"feature": t, "weight": round(w, 3)} for t, w in ranked[1:4]],
        }
    return out
