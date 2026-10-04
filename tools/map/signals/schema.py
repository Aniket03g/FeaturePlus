"""
Signal class: schema.

Feature names taken from the data model - CREATE TABLE in migrations, ORM/model
declarations in code, the generated Supabase types file, and any declarative
config that lists entities.

This class matters because it is largely independent of code layout (a
`bookings` table names the booking feature whether the app is Next.js, Django
or Go) and because it is the only signal that survives when a repo has no
recognisable page directory at all.

M8 correction, kept: v2 discarded any table name containing '_' on the theory
that it was a join table. That is true for Grove and false for every snake_case
schema - it threw away ~60 of aia's 86 real tables. `table_vocab(mode="head")`
replaces the rule; `mode="old"` is retained so the two can still be compared.
"""

import collections
import re
from pathlib import Path

from ..repo import read_text
from ..vocab import STOPWORDS, singular


def features_from_config(repo: Path):
    """Feature names sitting in a schema/config file, if one exists."""
    found = {}
    for candidate in repo.rglob("*.yaml"):
        if "node_modules" in candidate.parts:
            continue
        try:
            import yaml

            data = yaml.safe_load(candidate.read_text(encoding="utf-8", errors="replace"))
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        tables = data.get("tables") or data.get("entities") or data.get("models")
        if isinstance(tables, dict):
            rel = str(candidate.relative_to(repo)).replace("\\", "/")
            found[rel] = sorted(tables.keys())
    return found


MODEL_DIRS = ("model", "models", "entity", "entities", "db", "database",
              "domain", "schema", "store", "storage")


def in_model_dir(f: str, legacy: bool) -> bool:
    """
    Does this file sit somewhere the data model is declared?

    The trial tested `"/model" not in f`, which needs a LEADING slash and so
    never matched a top-level `models/` folder - the commonest layout in Go and
    Django both. That is why TaskTrackerGo had no schema signal at all, why
    nothing proposed `user`, and why `models/user.go` could not be placed.

    Matching on path segments instead fixes it without widening the net: a file
    called `modeless.ts` still does not match, because the segment has to *be* a
    model directory, not merely contain the letters.

    `legacy=True` keeps the broken test so the reproduction check still compares
    like with like.
    """
    if legacy:
        return "/model" in f or "/db/" in f or "/entit" in f
    return any(seg.lower() in MODEL_DIRS for seg in f.split("/")[:-1])


def features_from_schema(repo: Path, files, legacy=False):
    """ORM/model declarations, when the project has them in code."""
    names = collections.defaultdict(list)
    pat = re.compile(
        r"(?:CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`\"']?(\w+)|"
        r"class\s+(\w+)\s*\(\s*(?:models\.)?Model|"
        r"type\s+(\w+)\s+struct)",
        re.IGNORECASE,
    )
    for f in files:
        if not in_model_dir(f, legacy):
            continue
        for m in pat.finditer(read_text(repo, f)):
            name = next(g for g in m.groups() if g)
            names[singular(name.lower())].append(f)
    return names


def features_from_sql(repo: Path, sqls):
    """
    Supabase/Postgres migrations. Vibecoded apps almost never have an ORM
    model layer, but they do have a migrations directory, and CREATE TABLE is
    as close to a declared feature boundary as this population gets.
    """
    names = collections.defaultdict(list)
    pat = re.compile(
        r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"
        r"(?:[`\"']?public[`\"']?\s*\.\s*)?[`\"']?(\w+)",
        re.IGNORECASE,
    )
    for f in sqls:
        for m in pat.finditer(read_text(repo, f)):
            names[singular(m.group(1).lower())].append(f)
    return names


def features_from_supabase_types(repo: Path, files):
    """
    The generated src/integrations/supabase/types.ts lists every table under a
    Tables: { ... } block. Where migrations are absent this is the only
    machine-written inventory of the schema in the repo.
    """
    names = collections.defaultdict(list)
    for f in files:
        if "supabase" not in f or Path(f).name not in {"types.ts", "database.types.ts"}:
            continue
        text = read_text(repo, f)
        m = re.search(r"Tables:\s*\{", text)
        if not m:
            continue
        depth, i = 0, m.end() - 1
        while i < len(text):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        block = text[m.end():i]
        for tm in re.finditer(r"^\s{6,10}(\w+)\s*:\s*\{", block, re.MULTILINE):
            names[singular(tm.group(1).lower())].append(f)
    return names


def table_vocab(tables, mode):
    """
    Turn raw table names into feature terms.

    old   - v2's rule: anything containing '_' is assumed to be a join table
            and discarded. True for Grove, false for every snake_case schema.
    head  - keep the compound as a phrase AND take its head noun, which is the
            last token for English compounds (learning_track_submission ->
            submission, plus the phrase itself). Join tables are instead
            detected by their real signature: exactly two tokens that are both
            already known table names.
    """
    known = {t.lower() for t in tables}
    out = set()
    for t in tables:
        t = t.lower()
        toks = [x for x in re.split(r"[_\s-]+", t) if x]
        if mode == "old":
            if "_" in t or len(t) <= 3 or t in STOPWORDS:
                continue
            out.add(singular(t))
            continue
        # head mode
        if len(toks) == 2 and all(
            (singular(x) in {singular(k) for k in known} or x in known) for x in toks
        ):
            continue  # a genuine join table: both halves are tables themselves
        for tok in toks:
            if len(tok) > 3 and tok not in STOPWORDS and not tok.isdigit():
                out.add(singular(tok))
        if len(t) > 3:
            out.add(singular(t))
    return out


def collect_tables(repo: Path, files, sqls, all_files, legacy=False):
    """
    Every raw table/model name the repo declares, from all four sources.

    Returned as a list rather than a set because trial 3 counts raw names before
    de-duplication, and `table_vocab` needs the duplicates to decide which
    two-token names are join tables.
    """
    sql_features = features_from_sql(repo, sqls)
    types_features = features_from_supabase_types(repo, all_files)
    schema_features = features_from_schema(repo, files, legacy=legacy)
    raw = list(sql_features) + list(types_features) + list(schema_features)
    return raw, sql_features, types_features, schema_features


def schema_file_map(sql_features, types_features, schema_features):
    """
    term -> files that declare it. The trial only ever needed the term set; a
    map needs to know that `models/task.go` is where `task` was declared, since
    that is a strong ownership hint for the file itself.
    """
    out = collections.defaultdict(list)
    for src in (sql_features, types_features, schema_features):
        for term, files in src.items():
            out[term].extend(files)
    return out
