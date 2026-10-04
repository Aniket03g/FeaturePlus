"""
Is this codebase organised by feature, or by architectural layer?

The directory-name signal was added because trial 3 found /map blind to the
Next.js App Router: there the feature name lives in the directory
(`app/bookings/page.tsx`) and every file is called `page.tsx`. It fixed that.
It then broke idiomatic Go, where the directories are `handlers/`, `models/`,
`middleware/` - architectural layers, not features - so on TaskTrackerGo the
top-ranked "features" came back as `handler`, `model`, `middleware`, `token`
while `task`, `project` and `auth` ranked below them.

Both layouts are extremely common, so neither can be assumed. What makes this
tractable is that the two are the same fact seen from opposite sides:

    layer-first     directory = architecture,  filename = feature
                    handlers/task.go, models/project.go, middleware/auth.go

    feature-first   directory = feature,       filename = role
                    app/bookings/page.tsx, features/billing/index.ts

So the shape is measurable without knowing which framework produced it: count
how often the *directory* is an architectural word, and how often the *filename*
is a generic role word. High layerness with low genericness means the file tree
is telling us about architecture and its directory names must not be read as
feature names. High genericness means the opposite, and directory names are the
only thing worth reading.

Detection is per top-level subtree, not per repo, because a monorepo genuinely
has both: Grove's `frontend/` is page-per-feature Astro while its `proxy/` is
layer-first Go, and a single repo-wide verdict would be wrong for one of them.
"""

import collections
from pathlib import Path

from .vocab import singular, split_name

# Directory names that describe an architectural layer. A file living in one of
# these tells you what KIND of code it is, not which feature it serves. This is
# a fixed vocabulary of well-known architecture words - the same category as the
# existing STOPWORDS, not a per-repo tuning knob.
LAYER_DIRS = {
    "handler", "handlers", "controller", "controllers", "service", "services",
    "model", "models", "entity", "entities", "repository", "repositories",
    "middleware", "middlewares", "view", "views", "component", "components",
    "hook", "hooks", "util", "utils", "helper", "helpers", "lib", "libs",
    "api", "apis", "route", "routes", "router", "store", "stores", "type",
    "types", "schema", "schemas", "migration", "migrations", "db", "database",
    "config", "configs", "test", "tests", "spec", "specs", "internal", "pkg",
    "cmd", "src", "app", "server", "client", "core", "common", "shared",
    "context", "provider", "providers", "reducer", "reducers", "action",
    "actions", "selector", "selectors", "dto", "dtos", "mapper", "mappers",
    "validator", "validators", "interface", "interfaces", "adapter", "adapters",
    "domain", "infra", "infrastructure", "usecase", "usecases",
}

# Filename stems that describe a file's role rather than its subject. When most
# files in a subtree are called these, the directory is carrying the meaning.
GENERIC_STEMS = {
    "page", "index", "layout", "route", "loading", "error", "template",
    "default", "not-found", "notfound", "middleware", "main", "mod", "init",
    "component", "container", "view", "types", "constants", "utils", "helpers",
    "hooks", "context", "provider", "store", "actions", "reducer", "service",
    "controller", "model", "handler", "repository", "schema", "client", "server",
    "config", "api",
}

# Role words that must never earn credit from the file tree. A word appearing as
# a directory because it names a layer is explained by architecture, so it gets
# no code-layout evidence. It keeps commit and schema evidence, which is what
# lets a genuine `token` feature in a crypto app still rank: it will have a
# tokens table and real commit traffic, and will not depend on the file tree.
#
# Words that name a unit of code rather than a subject. They arrive through
# commit subjects ("add dashboard endpoint", "extract task handler") rather than
# through the file tree, which is why silencing the directory signal alone does
# not sink them - on TaskTrackerGo `endpoint` tied with `task` and `project` on
# commit count and won the tie alphabetically.
CODE_NOUNS = {
    "endpoint", "endpoints", "request", "response", "payload", "module",
    "modules", "package", "packages", "method", "methods", "function",
    "functions", "class", "classes", "struct", "structs", "field", "fields",
    "column", "columns", "table", "tables", "query", "queries", "mutation",
    "mutations", "wrapper", "helper", "boilerplate", "scaffold",
    # Plumbing nouns, added after round two. Each of these claimed a file on
    # Grove purely because it is the dominant word inside one: `path` took
    # proxy/handler.go on 21 mentions, `logger` took logger.go and
    # request_logger.go. They describe machinery every feature uses.
    "path", "url", "uri", "logger", "logging", "callback", "cache", "buffer",
    "timeout", "retry", "session", "header", "cookie", "socket", "thread",
}

# Words for something the application DOES, rather than something it is about.
# `email` is the measured case: on Grove it took `send-email.ts` (a quote file -
# it emails a quote) and `authorize.go` (a user file - it emails on failed
# authorisation). Both are true statements about the file and neither names the
# feature it belongs to, because emailing is a capability the whole app has.
#
# `admin` was the same shape in round one. The tell is that the word answers
# "what does this do to the data" rather than "what data is this about", so it
# turns up inside files belonging to every feature.
#
# Same escape hatch as the role words: a mail client genuinely about email will
# have an `emails` table, and a declared table lifts the mute. The word is only
# suppressed when the file tree and the prose are the ONLY things saying it.
CAPABILITY_WORDS = {
    "email", "mail", "export", "import", "upload", "download", "search",
    "filter", "sort", "print", "share", "sync", "notify", "notification",
    "send", "receive", "publish", "archive", "backup", "restore",
}

ROLE_WORDS = ({singular(w) for w in LAYER_DIRS}
              | {singular(w) for w in GENERIC_STEMS}
              | {singular(w) for w in CODE_NOUNS}
              | {singular(w) for w in CAPABILITY_WORDS})


def subtree_of(path: str) -> str:
    parts = path.split("/")
    return parts[0] if len(parts) > 1 else "(root)"


def _shape_from_counts(n_files, layer_hits, generic_hits):
    layerness = layer_hits / n_files if n_files else 0.0
    genericness = generic_hits / n_files if n_files else 0.0
    # Feature-first is judged first: generic filenames are the stronger and less
    # ambiguous tell, because a repo where most files are called page.tsx cannot
    # be identifying features any other way.
    if genericness >= 0.40:
        shape = "feature-first"
    elif layerness >= 0.50 and genericness < 0.30:
        shape = "layer-first"
    else:
        shape = "mixed"
    return {
        "shape": shape,
        "files": n_files,
        "layerness": round(layerness, 3),
        "genericness": round(genericness, 3),
    }


def detect_shape(files):
    """Layout shape of one set of files."""
    layer_hits = generic_hits = 0
    for f in files:
        p = Path(f)
        parent = p.parent.name.lower()
        if singular(parent) in LAYER_DIRS or parent in LAYER_DIRS:
            layer_hits += 1
        stem = p.stem.lower()
        # Strip a trailing _test/.test/.spec so task_test.go is judged as `task`.
        for suf in ("_test", ".test", ".spec", "_spec"):
            if stem.endswith(suf):
                stem = stem[: -len(suf)]
        if stem in GENERIC_STEMS or singular(stem) in GENERIC_STEMS:
            generic_hits += 1
    return _shape_from_counts(len(files), layer_hits, generic_hits)


def detect_shapes(files):
    """
    Shape per top-level subtree, plus an overall verdict.

    A subtree with fewer than 5 source files is not measured on its own - the
    ratios are meaningless at that size - and inherits the repo-wide verdict.
    """
    by_sub = collections.defaultdict(list)
    for f in files:
        by_sub[subtree_of(f)].append(f)

    overall = detect_shape(files)
    shapes = {}
    for sub, fs in by_sub.items():
        shapes[sub] = detect_shape(fs) if len(fs) >= 5 else dict(overall, inherited=True)
    return overall, shapes


# How much the directory-name vote is worth, by layout shape. In a layer-first
# subtree the directory name is not evidence about which feature a file serves,
# so it is silenced rather than merely reduced - `handlers/` says nothing about
# task versus project. In a feature-first subtree it is the primary evidence.
DIRNAME_MULTIPLIER = {
    "feature-first": 1.0,
    "mixed": 0.6,
    "layer-first": 0.0,
}


def dirname_multiplier(shapes, overall, file_path):
    sub = subtree_of(file_path)
    shape = shapes.get(sub, overall)["shape"]
    return DIRNAME_MULTIPLIER.get(shape, 0.6)


def is_role_word(term: str) -> bool:
    return singular(term) in ROLE_WORDS


# A directory holding this much of the codebase is a container, not a feature.
# Grove's `frontend/` holds 40 of 70 files and `proxy/` holds 30 - they are the
# two halves the app is split into, and they were ranking 11th and 12th as
# "features" purely because the directory signal counted them.
#
# Expressed as a share rather than as "depth 0" on purpose: some repos genuinely
# do put features at the top level (`billing/`, `invoicing/`), and those hold a
# small slice each. Size is what separates a container from a feature, not depth.
CONTAINER_SHARE = 0.25


def container_terms(dir_files, total_files):
    """Directory terms that cover so much of the repo they cannot be features."""
    if not total_files:
        return set()
    return {term for term, files in dir_files.items()
            if len(set(files)) / total_files >= CONTAINER_SHARE}


def feature_dir_terms(dir_files, shapes, overall, total_files=0):
    """
    Directory-derived terms that are allowed to count as code-layout evidence.

    A term is excluded when it is a known architectural role word, when it names
    a container holding a quarter or more of the codebase, or when every
    directory it comes from sits in a layer-first subtree. What survives is a
    directory name that genuinely looks like a feature.
    """
    containers = container_terms(dir_files, total_files)
    keep = {}
    for term, files in dir_files.items():
        if is_role_word(term) or term in containers:
            continue
        live = [f for f in files
                if DIRNAME_MULTIPLIER.get(
                    shapes.get(subtree_of(f), overall)["shape"], 0.6) > 0]
        if live:
            keep[term] = live
    return keep
