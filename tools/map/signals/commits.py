"""
Signal class: history (commit messages).

Trial 3's strongest finding and the backbone of the mapper.

Why it leads: it is the only signal independent of code layout by construction
- the words come from a human (or a human's prompt), not from the file tree -
it exists in every repo including the single-signal SPAs where corroboration
has nothing to work with, and it attributed 43-97% of files directly. On
`rido-drive-smiles` it named `driver`, `settlement`, `debt`, `fleet` and
`invoice`, none of which any code signal saw.

Its weaknesses are known and handled elsewhere: it needs history to exist
(guarded by history health), it is English-biased (the COMMIT_NOISE filter),
and raw terms need ranking rather than gating (done in the scorer).
"""

import collections
import re

from ..vocab import COMMIT_NOISE, STOPWORDS, singular, split_name


def commit_vocabulary(commits, min_commits=3):
    """
    Feature names as the author actually said them, taken from commit subjects.

    It yields something no text-matching signal can: a direct feature -> file
    attribution, because the commit that says "booking" also lists the files it
    touched.

    The 1..30 file guard matters - a 400-file commit says nothing about which
    file the subject line was about, so it contributes vocabulary but not
    attribution.
    """
    term_commits = collections.Counter()
    term_files = collections.defaultdict(collections.Counter)
    for c in commits:
        subject = c["subject"]
        # Drop conventional-commit prefixes and bot boilerplate.
        subject = re.sub(r"^\s*\w+(\([^)]*\))?:\s*", "", subject)
        subject = re.sub(r"\[skip [^\]]*\]", " ", subject, flags=re.I)
        toks = []
        for raw in re.split(r"[^A-Za-z0-9]+", subject):
            toks += split_name(raw)
        seen = set()
        for t in toks:
            t = singular(t.lower())
            if len(t) <= 3 or t in STOPWORDS or COMMIT_NOISE.match(t) or t.isdigit():
                continue
            seen.add(t)
        files = set(c["files"])
        for t in seen:
            term_commits[t] += 1
            if 1 <= len(files) <= 30:
                for f in files:
                    term_files[t][f] += 1
    vocab = {t for t, n in term_commits.items() if n >= min_commits}
    return vocab, term_commits, term_files


def commit_attribution(term_files, vocab, files):
    """
    Coverage of the map you get from commit messages alone, with no text
    matching at all: a file belongs to the term whose commits touched it most.

    DETERMINISM FIX (the known v4 defect). The trial iterated `vocab`, a set,
    and kept a term only on a strict `>`, so ties were broken by set iteration
    order - which varies per process under hash randomisation. Two runs on the
    same repo could assign a file to different terms. Terms are now visited in
    sorted order and ties break on the term name, so the result is reproducible.
    This changes only tied cases; any file with a clear winner is unaffected.
    """
    best = {}
    for t in sorted(vocab):
        for f, n in sorted(term_files[t].items()):
            if f not in files:
                continue
            if f not in best or n > best[f][1]:
                best[f] = (t, n)
    return best


def commit_attribution_legacy(term_files, vocab, files):
    """
    The trial's exact implementation, order-dependence included.

    Retained only so the reproduction check can prove the refactor changed
    nothing before the fix is applied on top. Do not use in the mapper.
    """
    best = {}
    for t in vocab:
        for f, n in term_files[t].items():
            if f not in files:
                continue
            if f not in best or n > best[f][1]:
                best[f] = (t, n)
    return best
