"""
Emit a feature map as the markdown the dependency canvas already reads.

This is the cheapest possible way to look at an extraction: no staging table,
no import flow, no API. `frontend/src/lib/dependency-markdown.ts` parses a
hand-written map so a shape can be tried without creating a project, and the
result goes through the same renderer as the real thing - so a file written here
opens in the canvas via "Open a file" and looks exactly like a project would.

It answers the only question that matters before any of this is built: does the
picture look right to the person who wrote the code?

What the format carries, and where each part comes from:

    bullet          a feature the mapper ranked and let claim files
    [done]          every extracted feature is already built, by definition
    needs:          import direction - if A's files import B's files, A
                    requires B. Read from source, and directional.
    indentation     part-of. NOT emitted: deciding that `login`, `role` and
                    `permission` are parts of one Security feature is the
                    naming step's job, and that step is a model call this
                    package deliberately does not make. A flat map is the
                    honest output of a deterministic core.

Co-change is not used here. It is symmetric - two files changing together says
nothing about which one depends on the other - so it can support an arrow but
can never be its source.
"""

import collections
from pathlib import Path

from .classify import import_pairs

# How many of a feature's own files must reach into another feature before the
# arrow is drawn. One stray import is a detail; two files agreeing is a shape.
MIN_IMPORTING_FILES = 2

# A hub feature can import a dozen others, and twelve arrows out of one card is
# not a picture anyone can read. The strongest are kept, and the count of what
# was held back is reported rather than hidden.
MAX_NEEDS_PER_FEATURE = 5


def title_of(term: str) -> str:
    """`booking` -> `Booking`, `pull-request` -> `Pull Request`."""
    return " ".join(w.capitalize() for w in term.replace("_", " ").replace("-", " ").split())


def feature_edges(repo: Path, files, assigned,
                  min_files=MIN_IMPORTING_FILES,
                  max_needs=MAX_NEEDS_PER_FEATURE):
    """
    Turn file-level imports into feature-level `requires` edges.

    Returns (edges, stats) where edges maps a feature to the features it
    requires, strongest first, and stats records what the imports were able to
    say - because "no arrows" has two very different causes (a repo with no
    internal imports, or a repo whose imports all land on unattributed files)
    and a reviewer needs to know which one they are looking at.
    """
    owner = {f: v["feature"] for f, v in assigned.items()}

    # Go imports a package, so a Go target is a directory rather than a file.
    # A package whose files belong to several features cannot be resolved to
    # one of them, so those imports are skipped rather than counted for each -
    # crediting every feature in the package would manufacture arrows.
    by_dir = collections.defaultdict(collections.Counter)
    for f, feat in owner.items():
        by_dir[str(Path(f).parent).replace("\\", "/")][feat] += 1

    def target_feature(target: str):
        if target in owner:
            return owner[target]
        counts = by_dir.get(target.rstrip("/"))
        if not counts:
            return None
        (best, n), total = counts.most_common(1)[0], sum(counts.values())
        return best if n * 2 > total else None

    # Counted as distinct importing files, not raw import statements: one file
    # importing six modules of another feature is one piece of evidence, not six.
    votes = collections.defaultdict(set)
    stats = collections.Counter()

    for src, target in import_pairs(repo, files):
        stats["pairs"] += 1
        src_feature = owner.get(src)
        if src_feature is None:
            stats["source_unattributed"] += 1
            continue
        dst_feature = target_feature(target)
        if dst_feature is None:
            stats["target_unattributed"] += 1
            continue
        if dst_feature == src_feature:
            stats["within_feature"] += 1
            continue
        stats["crossing"] += 1
        votes[(src_feature, dst_feature)].add(src)

    edges = collections.defaultdict(list)
    for (src_feature, dst_feature), srcs in votes.items():
        if len(srcs) < min_files:
            stats["below_threshold"] += 1
            continue
        edges[src_feature].append((dst_feature, len(srcs)))

    for feature, needs in edges.items():
        needs.sort(key=lambda kv: (-kv[1], kv[0]))
        if len(needs) > max_needs:
            stats["capped"] += len(needs) - max_needs
            del needs[max_needs:]

    stats["edges"] = sum(len(v) for v in edges.values())
    return edges, stats


def _titled_rows(kept):
    """The features that claimed files, and the name each one is shown under."""
    rows = [r for r in kept if r["claims"] and r["file_count"] > 0]
    titles = {}
    for r in rows:
        title = title_of(r["term"])
        # The parser rejects a repeated name, so two terms that title-case to
        # the same thing would silently lose one feature. Keep the better-ranked.
        if title.lower() in {t.lower() for t in titles.values()}:
            continue
        titles[r["term"]] = title
    return rows, titles


def build_canvas_markdown(a, kept, assigned, unassigned, edges, stats) -> str:
    """
    The document. Everything that is not a bullet is ignored by the parser, so
    the notes at the top cost nothing and travel with the file - which matters,
    because someone will open this weeks later with no idea what made it.
    """
    rows, titles = _titled_rows(kept)

    L = []
    w = L.append
    w(f"# {a.label}")
    w("")
    w(f"Extracted from `{a.repo}` by tools/map - {len(rows)} features over "
      f"{sum(r['file_count'] for r in rows)} of {len(a.files)} source files.")
    w("")
    w("A draft, not an answer. Arrows are read from import direction: where one "
      "feature's files import another's, it is drawn as requiring it. Features "
      "are flat because grouping them is a later step.")
    w("")
    if stats["edges"] == 0:
        w("_No arrows: nothing crossed between two attributed features often "
          "enough. See the counts printed by the run._")
        w("")

    for r in rows:
        title = titles.get(r["term"])
        if title is None:
            continue
        needs = [titles[t] for t, _ in edges.get(r["term"], []) if t in titles]
        line = f"- {title} [done]"
        if needs:
            line += " > needs: " + ", ".join(needs)
        w(line)

    w("")
    w(f"Not on the map: {len(unassigned)} files no signal had an opinion about, "
      f"plus everything bucketed as plumbing, wiring, static content or vendored. "
      f"The full evidence is in map-{a.label}.md.")
    w("")
    return "\n".join(L)


def write_canvas_markdown(a, kept, assigned, unassigned, out: Path,
                          min_files=MIN_IMPORTING_FILES,
                          max_needs=MAX_NEEDS_PER_FEATURE):
    edges, stats = feature_edges(a.repo, a.files, assigned,
                                min_files=min_files, max_needs=max_needs)
    out.write_text(build_canvas_markdown(a, kept, assigned, unassigned,
                                         edges, stats), encoding="utf-8")
    return stats


def build_features_markdown(a, kept) -> str:
    """
    Names only, for the playground: no status, no arrows, no files. It is the
    list a person reviews before any of it becomes a project, so everything
    the reviewer would have to strip out first is left out here.
    """
    _, titles = _titled_rows(kept)
    L = [f"# {a.label}", "",
         f"Features found in `{a.repo}` by tools/map. A draft to review: rename, "
         "nest, untick or delete before importing.", ""]
    L += [f"- {t}" for t in titles.values()]
    L.append("")
    return "\n".join(L)


def write_features_markdown(a, kept, out: Path):
    out.write_text(build_features_markdown(a, kept), encoding="utf-8")
