"""
Signal class: code layout.

Feature names read off the file tree - page filenames, declared route tables,
and directory names.

Trial 3 established two things about this class that shape the module:

  1. Pages and routes are NOT independent signals. Route terms were 79-100%
     derivable from page filenames, so corroborating one against the other
     proves nothing. They belong to one class, which is why they live in one
     module here rather than being counted separately.

  2. `features_from_pages` is blind to the Next.js App Router. It requires a
     directory literally named pages/routes/views/screens containing the page
     *files*; App Router puts the feature name in the directory and calls every
     file page.tsx. On the three App Router repos in the sample it returned 0-1
     terms while directory names carried 64-166.

So `dir_vocab` is promoted here to a first-class signal function. It existed in
trial 3 only as a few inline lines in main(); it is the cheapest candidate fix
for App Router blindness, and testing whether it alone closes that gap is what
decides whether any framework-specific code needs writing at all.
"""

import collections
import re
from pathlib import Path

from ..repo import read_text
from ..vocab import (DIR_STOPWORDS, PAGE_VERBS, STOPWORDS, singular,
                     split_name, usable)


def features_from_pages(files):
    """
    Filesystem-routed pages. v1 handled Astro's pages/ and kebab-case names;
    v2 additionally accepts src/pages/*.tsx with PascalCase names, which is
    what every Vite/React vibecoded app produces.

    Known limitation, measured in trial 3: the `(pages|routes|views|screens)/`
    requirement means this sees nothing in a Next.js App Router repo. Left
    unchanged so v2/v3 numbers stay reproducible; `dir_vocab` is the fix.
    """
    groups = collections.defaultdict(list)
    for f in files:
        if not re.search(r"(^|/)(pages|routes|views|screens)/", f):
            continue
        stem = Path(f).stem
        if stem.startswith("[") or stem.lower() in {"index", "env.d"}:
            stem = Path(f).parent.name
        tokens = split_name(stem)
        tokens = [t for t in tokens if t not in PAGE_VERBS] or tokens
        tokens = [t for t in tokens if t not in STOPWORDS]
        if not tokens:
            continue
        groups[singular(tokens[0])].append(f)
    return groups


def features_from_routes(repo: Path, files):
    """
    React-Router / Vue-Router declare routes in code rather than in the
    filesystem, so the route table has to be parsed out. This is the direct
    analogue of the Go route table v1 relied on for the Grove proxy.
    """
    pat = re.compile(r"""<Route\s+[^>]*path\s*=\s*["'{]([^"'}]+)["'}]""")
    alt = re.compile(r"""\bpath\s*:\s*["']([^"']+)["']""")
    groups = collections.defaultdict(list)
    for f in files:
        if Path(f).suffix.lower() not in {".tsx", ".jsx", ".ts", ".js", ".vue"}:
            continue
        text = read_text(repo, f)
        if "Route" not in text and "path" not in text:
            continue
        paths = pat.findall(text) + (alt.findall(text) if "createBrowserRouter" in text
                                     or "routes" in text.lower() else [])
        for p in paths:
            for seg in p.split("/"):
                seg = seg.strip()
                if not seg or seg.startswith(":") or seg in {"*", "."}:
                    continue
                tokens = [t for t in split_name(seg) if t not in PAGE_VERBS
                          and t not in STOPWORDS]
                if tokens:
                    groups[singular(tokens[0])].append(f)
                break
    return groups


def features_from_dirs(files):
    """
    Feature names taken from directory names, with the files that sit under them.

    Promoted from trial-3 inline code to a real signal, and extended: the trial
    only collected the vocabulary, throwing away which files each term came
    from. The files are what a *map* needs, so they are kept here.

    Why this is the App Router answer: `app/bookings/page.tsx` names the feature
    in the directory. It is also framework-agnostic - `handlers/booking/`,
    `app/bookings/`, `src/features/invoicing/` all work the same way, with no
    knowledge of which framework produced them.
    """
    groups = collections.defaultdict(list)
    for f in files:
        for part in Path(f).parent.parts:
            for raw in split_name(part):
                t = singular(raw)
                if len(t) > 3 and t not in STOPWORDS and t not in DIR_STOPWORDS:
                    groups[t].append(f)
    return groups


def features_from_filenames(files, known_terms):
    """
    The file's own name, as a CONFIRMING vote for a feature already proposed
    elsewhere. `create-quote.astro` is self-evidently a quote file.

    This was missing entirely: directories voted on which feature a file belongs
    to, filenames never did. It showed up as soon as the text signal was
    ungated - `create-quote.astro` went to `product` because the page lists
    products, and nothing was allowed to point at the word "quote" in its name.

    Confirming, not proposing, and that restriction is the whole design. If a
    filename could propose a feature, every unmatched file would become its own
    one-file feature - `debounce.ts` would be the Debounce feature. So a
    filename only ever picks among terms some other signal already nominated.
    Page filenames DO propose, but through features_from_pages, which requires
    the file to live in a routed directory and so cannot fire on a utility.

    Leading verbs are stripped the same way features_from_pages strips them, so
    `create-quote`, `add-account` and `edit-account` resolve to their nouns.
    """
    groups = collections.defaultdict(list)
    for f in files:
        stem = Path(f).stem
        if stem.startswith("[") or stem.lower() in {"index", "env.d"}:
            continue
        for suf in ("_test", ".test", ".spec", "_spec"):
            if stem.lower().endswith(suf):
                stem = stem[: -len(suf)]
        tokens = [t for t in split_name(stem) if t not in PAGE_VERBS] or split_name(stem)
        for raw in tokens:
            t = singular(raw)
            if t in known_terms and t not in STOPWORDS:
                groups[t].append(f)
    return groups


def dir_vocab(files):
    """
    Directory-name vocabulary only, byte-identical to the set trial 3's main()
    built inline. Kept as its own function so the reproduction check can assert
    the refactor changed nothing.
    """
    return set(features_from_dirs(files))


def layout_tokens(files):
    """
    Every token derivable from the file tree (own stem + immediate parent).

    This is the yardstick the derivability tests measure against: a signal whose
    terms are all in here told us nothing the filenames had not already said.
    """
    toks = set()
    for f in files:
        toks |= {singular(t) for t in split_name(Path(f).stem)}
        toks |= {singular(t) for t in split_name(Path(f).parent.name)}
    return toks


# A filename word must clear both of these before it may PROPOSE a feature.
# Two files guards against `debounce.ts` becoming the Debounce feature; two
# directories is what separates a feature from an architectural layer, because a
# feature recurs across layers while a layer word stays inside its own folder.
FILENAME_PROPOSE_MIN_FILES = 3
FILENAME_PROPOSE_MIN_DIRS = 2


def recurring_filename_terms(files):
    """
    Filename words allowed to propose a feature, for repos where nothing else can.

    Career-Cloud is the measured case: a C# solution with no web layer, no SQL
    (Entity Framework declares its tables in code), and every commit message left
    at GitHub's default "Add files via upload". Pages, routes, schema and commits
    were therefore all empty or junk, the directories are pure layers
    (`BusinessLogicLayer`, `Pocos`), and the only place the features existed was
    the filenames - which were barred from proposing. The map came back empty.

    The bar that makes proposing safe is recurrence, not the word itself.
    `ApplicantProfile`, `ApplicantResume` and `ApplicantSkill` say "applicant" in
    18 files across 3 directories; that is a claim the repo makes over and over,
    in independent places, and no longer the circular self-nomination that the
    confirm-only rule was written to prevent.

    Returns {term: (n_files, n_dirs)} so the caller can report why a term is here.
    """
    n_files = collections.Counter()
    dirs = collections.defaultdict(set)
    for f in files:
        stem = Path(f).stem
        toks = [t for t in split_name(stem) if t not in PAGE_VERBS] or split_name(stem)
        for t in set(toks):
            if not usable(t):
                continue
            n_files[t] += 1
            dirs[t].add(str(Path(f).parent))
    return {t: (c, len(dirs[t])) for t, c in n_files.items()
            if c >= FILENAME_PROPOSE_MIN_FILES
            and len(dirs[t]) >= FILENAME_PROPOSE_MIN_DIRS}
