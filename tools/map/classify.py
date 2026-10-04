"""
Bucketing files that should not be attributed to a feature.

This module is why trial 3's headline number moved from "~33% of files serve
more than one feature" to "genuinely split logic is a median 1.9%, never above
5.2%". Both populations were being counted as one:

  aggregator  - wiring. A nav bar names Home, Bookings, Profile and Settings
                because that is its job; it holds no business logic. Handing it
                over whole is fine, and "one third of a nav bar" is not a thing.
  split-logic - real booking logic and real payment logic interleaved in one
                file. This is the animal that actually breaks feature mapping,
                and it is rare.

Also here: vendored code detection, which removes library code that merely
happens to be committed (shadcn and friends) before it dilutes every ratio.
"""

import collections
import os
import math
import re
import statistics
from pathlib import Path

from .layout import is_role_word
from .repo import go_module_name, read_text
from .vocab import split_name

# Names that announce a file's job is wiring, not business logic.
AGGREGATOR_NAME = re.compile(
    r"(nav|navigation|menu|sidebar|header|footer|router|routes?|app|layout|"
    r"shell|search|command|palette|registry|index|dashboard|home|overview|"
    r"breadcrumb|tabs?|switcher|picker|directory|sitemap|links?)",
    re.IGNORECASE,
)

# Things that indicate real work is happening in the file.
LOGIC_PAT = re.compile(
    r"\b(await\s|\.then\(|useMutation|useQuery|supabase\s*\.|fetch\(|axios\.|"
    r"prisma\.|db\.|INSERT|UPDATE|DELETE|SELECT\s|try\s*\{|catch\s*\(|"
    r"reduce\(|filter\(|sort\(|validate|schema\.|zod|calculate|compute)\b",
    re.IGNORECASE,
)

# Things that indicate the file merely points somewhere else.
LINK_PAT = re.compile(
    r"(<Link\b|href\s*=|\bto\s*=|navigate\(|router\.push|redirect\(|"
    r"<Route\b|path\s*:|useNavigate)",
    re.IGNORECASE,
)

ROUTE_DECL = re.compile(r"(<Route\b|\bpath\s*:\s*['\"])")


def file_profile(repo: Path, rel: str, internal_imports: int):
    """Cheap structural description of one file, used to classify it."""
    text = read_text(repo, rel)
    lines = text.count("\n") + 1
    per100 = lambda n: (100.0 * n / lines) if lines else 0.0
    return {
        "lines": lines,
        "logic": len(LOGIC_PAT.findall(text)),
        "links": len(LINK_PAT.findall(text)),
        "logic_d": per100(len(LOGIC_PAT.findall(text))),
        "link_d": per100(len(LINK_PAT.findall(text))),
        "route_decls": len(ROUTE_DECL.findall(text)),
        "imports": internal_imports,
        "name_hint": bool(AGGREGATOR_NAME.search(Path(rel).stem)
                          or AGGREGATOR_NAME.search(Path(rel).parent.name)),
    }


def outdegree(repo: Path, files):
    """How many internal modules each file imports (fan-out, not fan-in)."""
    out = collections.Counter()
    ts_import = re.compile(r"""(?:from|import)\s+['"]([^'"]+)['"]""")
    for f in files:
        text = read_text(repo, f)
        if not text:
            continue
        n = 0
        for p in ts_import.findall(text):
            if p.startswith(("@/", "~/", ".")):
                n += 1
        if Path(f).suffix.lower() == ".go":
            n += len(re.findall(r'"[\w./-]+/[\w./-]+"', text))
        out[f] = n
    return out


def import_pairs(repo: Path, files):
    """
    Every internal import as an (importing file, imported target) pair.

    The resolution rules are the interesting part and they differ by language:
    Go imports a *package*, so a Go target is a directory; TypeScript imports a
    file, so a TS target is resolved to a real path, following the `@/foo` ->
    `src/foo` Vite alias. Without that alias every internal import in these
    repos looks external.

    `import_indegree` is this with the source discarded. The source is what an
    arrow needs: a count says a file is depended upon, a pair says by whom.
    Yielded once per occurrence, so counting the targets reproduces the
    indegree exactly.
    """
    mod, mod_root = go_module_name(repo)
    fileset = set(files)

    go_block = re.compile(r"import\s*\(([^)]*)\)", re.DOTALL)
    go_single = re.compile(r'^\s*import\s+(?:\w+\s+)?"([^"]+)"', re.MULTILINE)
    ts_import = re.compile(r"""(?:from|import)\s+['"]([^'"]+)['"]""")

    def resolve(cand: str):
        """Extensionless TS imports: try the real suffixes before giving up."""
        for ext in ("", ".ts", ".tsx", ".js", ".jsx", ".vue", ".astro",
                    "/index.ts", "/index.tsx"):
            if cand + ext in fileset:
                return cand + ext
        return cand

    for f in files:
        text = read_text(repo, f)
        if not text:
            continue
        ext = Path(f).suffix.lower()

        if ext == ".go" and mod:
            paths = []
            for block in go_block.findall(text):
                paths += re.findall(r'"([^"]+)"', block)
            paths += go_single.findall(text)
            for p in paths:
                if p.startswith(mod):
                    rel = p[len(mod):].lstrip("/")
                    target = f"{mod_root}/{rel}" if mod_root else rel
                    yield f, target

        elif ext in {".ts", ".tsx", ".js", ".jsx", ".mjs", ".astro", ".vue", ".svelte"}:
            for p in ts_import.findall(text):
                if p.startswith("@/"):
                    target = "src/" + p[2:]
                elif p.startswith("~/"):
                    target = "src/" + p[2:]
                elif p.startswith("."):
                    target = os.path.normpath(
                        os.path.join(os.path.dirname(f), p)
                    ).replace("\\", "/")
                else:
                    continue
                yield f, resolve(target)


def import_indegree(repo: Path, files):
    """
    How many files import each target. Go resolves to a package directory
    (Go imports packages, not files); TS resolves to a file path.

    See `import_pairs` for the resolution rules - this is that, counted.
    """
    return collections.Counter(t for _, t in import_pairs(repo, files))


def evenness(counts):
    """
    Normalised entropy of a file's feature-term counts.

    An aggregator names many features about equally often (a nav bar links each
    once), so evenness is near 1. A file where two features' logic is genuinely
    tangled has a couple of deep terms and a long tail, so evenness is lower.
    """
    vals = [n for n in counts if n > 0]
    if len(vals) < 2:
        return 0.0
    tot = sum(vals)
    h = -sum((v / tot) * math.log(v / tot) for v in vals)
    return h / math.log(len(vals))


def classify_contested(repo: Path, spread, outdeg):
    """
    Split the multi-feature files into the two populations v2 conflated.

    Logic per 100 lines is the discriminator that matters: a nav bar can be long
    and import a lot, but it does almost no work.
    """
    rows = []
    for f, v in sorted(spread.items()):
        if not v["rivals"]:
            continue
        p = file_profile(repo, f, outdeg.get(f, 0))
        nterms = 1 + len(v["rivals"]) + len(v["refs"])
        ev = evenness(list(v["counts"].values()))

        wiring_evidence = sum([
            p["name_hint"],
            p["route_decls"] >= 3,
            p["link_d"] >= 1.5,
            p["imports"] >= 8,
            ev >= 0.85 and nterms >= 4,
        ])
        does_work = p["logic_d"] >= 2.0 and p["logic"] >= 8

        if wiring_evidence >= 2 and not does_work:
            kind = "aggregator"
        elif wiring_evidence >= 3 and p["logic_d"] < 4.0:
            kind = "aggregator"
        elif does_work and v["owner_n"] >= 8 and v["rivals"][0][1] >= 8:
            kind = "split-logic"
        else:
            kind = "unclear"

        rows.append({
            "file": f, "kind": kind, "owner": v["owner"], "owner_n": v["owner_n"],
            "rivals": v["rivals"][:4], "nterms": nterms, "evenness": round(ev, 2),
            **{k: (round(x, 2) if isinstance(x, float) else x) for k, x in p.items()},
            "wiring_evidence": wiring_evidence,
        })
    return rows


# ------------------------------------------------------------- plumbing

# Files that hold the application together rather than implementing any part of
# it. Without this bucket they get handed to whichever feature happened to be
# mentioned in a nearby commit - `proxy/main.go` went to `admin`, then to `user`,
# and was never going to be right, because the correct answer is "none of them".

# Build, config and tooling files.
CONFIG_FILE = re.compile(
    r"(\.config\.(js|mjs|cjs|ts)$)|"
    r"((^|/)(tailwind|astro|vite|next|nuxt|webpack|rollup|esbuild|babel|jest|"
    r"vitest|playwright|eslint|prettier|tsconfig|svelte|drizzle)\.[\w.]+$)",
    re.IGNORECASE,
)

# Directories that hold wiring rather than features.
INFRA_DIR = re.compile(
    r"(^|/)(config|configs|settings|db|database|migrations?|infra|"
    r"infrastructure|deploy|scripts|tooling|logger|logging|telemetry)/",
    re.IGNORECASE,
)

# Filenames that are entry points or process wiring.
ENTRY_STEMS = {"main", "app", "server", "bootstrap", "setup", "wire", "init",
               "migrate", "serve", "run", "cli", "entrypoint",
               # A route table is the definition of wiring: it names every
               # feature and implements none. TaskTrackerGo's routes.go was
               # being handed to whichever feature its commits mentioned.
               "routes", "route", "router", "routing"}


def plumbing_files(a):
    """
    Files that serve the whole application, so they belong to no one feature.

    Four ways in, and the last three all carry the same guard: the filename must
    not itself name a known feature. That guard is what keeps
    `internal/db/announcements.go` out - it sits in an infra directory, but its
    name says `announcement`, and it really is the Announcements data layer.
    `internal/db/sqlite.go` next to it has no feature in its name and is
    plumbing. Same directory, different answers, decided by the filename.

      hub      imported by a large share of the repo (the measured shared
               bucket). Nothing more needs to be said about a file that half the
               codebase depends on.
      config   build and tooling config.
      infra    lives in a wiring directory.
      entry    named like a process entry point.
    """
    # The guard only counts names that could really be features. `logger.go`
    # inside `internal/logger/` was escaping the plumbing bucket because its own
    # name matched the term `logger` - a word that is not allowed to be a
    # feature anywhere else in the pipeline, so it must not rescue a file here
    # either.
    tables = a.schema_vocab_new | a.cfg_vocab
    feature_named = set()
    for term, fs in a.filename_files.items():
        if is_role_word(term) and term not in tables:
            continue
        feature_named.update(fs)

    hub = {f for f in a.shared_bucket if f in set(a.files)}
    out = {}
    for f in a.files:
        if f in hub:
            out[f] = "plumbing"
            continue
        if f in feature_named:
            continue  # its own name claims a feature; trust that over location
        stem = Path(f).stem.lower()
        first = split_name(stem)[0] if split_name(stem) else ""
        if CONFIG_FILE.search(f):
            out[f] = "plumbing"
        elif INFRA_DIR.search(f):
            out[f] = "plumbing"
        elif stem in ENTRY_STEMS or first in ENTRY_STEMS:
            out[f] = "plumbing"
    return out


# Above this share of the repo a "vendored" verdict is describing how the author
# commits rather than what the code is. Measured: the highest genuine rate in the
# 13-repo trial was games-website, 49 of 205 files (24%).
MAX_VENDORED_SHARE = 0.5


def vendored_by_history(repo: Path, files, commits, legacy=False):
    """
    Detect vendored code without knowing shadcn exists.

    "Never touched again" turned out not to be the discriminator: a vendored kit
    arrives in the root commit and then gets caught once by a sweeping reformat,
    so its files show the same ~2 touches as ordinary code.

    What does separate it cleanly is how the directory *arrived*. Vendored
    directories are dropped in whole - on games-website every one of the 49
    shadcn files came in a bulk commit (fraction 1.00) while no other directory
    in the repo exceeds 0.40, because application code accretes a few files at a
    time. Edit rate is kept only as a guard so a legitimately scaffolded-then-
    heavily-developed directory is not swept up.

    Career-Cloud showed the rule's blind spot: a repo uploaded through the
    GitHub web UI arrives in a handful of 20-file commits, so hand-written
    application code matches "dropped in whole" exactly. It flagged 60 of 64
    files and the map came back empty. Vendored code is a *pocket* of a repo by
    definition - if the rule wants most of the codebase it has detected a commit
    style, not a library, so the whole verdict is dropped rather than trusted.
    """
    touches = collections.Counter()
    first_commit_size = {}
    for c in reversed(commits):  # oldest first
        n = len(set(c["files"]))
        for f in set(c["files"]):
            touches[f] += 1
            if f not in first_commit_size:
                first_commit_size[f] = n

    by_dir = collections.defaultdict(list)
    for f in files:
        by_dir[os.path.dirname(f)].append(f)

    all_touch = [touches.get(f, 0) for f in files if touches.get(f, 0) > 0]
    repo_median = statistics.median(all_touch) if all_touch else 0

    flagged = set()
    for d, fs in by_dir.items():
        if len(fs) < 8:
            continue
        dir_median = statistics.median([touches.get(f, 0) for f in fs])
        bulk = [f for f in fs if first_commit_size.get(f, 0) >= 15]
        if len(bulk) / len(fs) >= 0.8 and dir_median <= repo_median:
            flagged.update(fs)

    # See the docstring: a majority verdict means the signal misfired.
    if not legacy and files and len(flagged) / len(files) > MAX_VENDORED_SHARE:
        return set(), touches
    return flagged, touches
