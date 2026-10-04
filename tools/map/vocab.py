"""
Word handling shared by every signal.

Moved verbatim out of the trial scripts (measure_v2.py, measure_v3.py). These
definitions decide what counts as a word and what counts as noise, so every
signal has to use the same ones or their vocabularies cannot be compared. Any
change here changes every measurement at once - that is the reason they live in
one place rather than being redefined per signal.
"""

import re

# Verbs that prefix a page name without naming a feature: create-lead -> lead.
PAGE_VERBS = {"create", "add", "edit", "new", "view", "update", "delete",
              "list", "detail", "details", "page", "index", "manage"}

# Words that are structural, never a feature name.
STOPWORDS = {"index", "main", "app", "root", "layout", "component", "components",
             "util", "utils", "lib", "helper", "helpers", "type", "types",
             "hook", "hooks", "test", "spec", "config", "style", "styles",
             "constant", "constants", "provider", "context", "route", "routes",
             "page", "pages", "not", "found", "notfound", "error"}

# Directory names that describe project structure rather than a feature. Used
# only by the dirname signal, which sees these constantly.
DIR_STOPWORDS = {"src", "components"}

# Commit-subject words that describe the *act* of committing rather than the
# thing being built. Without this filter the commit signal returns "fix",
# "update" and "wip" as the three biggest features in every repo.
COMMIT_NOISE = re.compile(
    r"^(fix|fixes|fixed|add|adds|added|update|updates|updated|remove|removed|"
    r"refactor|refactored|improve|improved|implement|implemented|create|created|"
    r"initial|commit|merge|revert|chore|feat|feature|bug|bugfix|wip|test|tests|"
    r"style|styles|docs|doc|build|deploy|version|bump|clean|cleanup|change|"
    r"changed|changes|make|made|use|using|new|the|and|for|with|from|into|this|"
    r"that|when|where|all|any|not|null|true|false|error|errors|issue|issues|"
    r"support|handle|ensure|allow|enable|disable|better|more|less|some|only|"
    r"also|now|via|per|set|get|run|try|working|work|works|final|first|last|"
    r"next|prev|previous|main|master|branch|file|files|code|logic|data|value|"
    r"button|color|colors|text|size|width|height|padding|margin|font|icon|"
    r"mobile|desktop|responsive|design|layout|page|pages|component|components|"
    r"lovable|claude|cursor|copilot|bolt|codex|skip|auto|automatic)$",
    re.IGNORECASE,
)


def singular(word: str) -> str:
    """Crude but sufficient: leads->lead, cases->case, address->address."""
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith("ss"):
        return word
    if word.endswith("s") and len(word) > 3:
        return word[:-1]
    return word


def split_name(stem: str):
    """
    Tokenise a filename into words. v1 only had to handle kebab-case
    (create-lead.astro); vibecoded React repos are PascalCase (LeadDetail.tsx),
    so camel boundaries have to be split too or every page becomes one token.
    """
    parts = re.split(r"[-_.\s]+", stem)
    tokens = []
    for p in parts:
        tokens += re.findall(r"[A-Z]+(?![a-z])|[A-Z][a-z]+|[a-z]+|\d+", p)
    return [t.lower() for t in tokens if t]


def usable(term: str) -> bool:
    """
    The filter the trial applied to every code-derived vocabulary before use.

    Note the `_` rule: it drops any compound outright. That is correct for
    filename tokens (they are already split) but was wrong for table names,
    which is what M8 found - so the schema signal deliberately does not use
    this, see signals/schema.table_vocab.
    """
    return "_" not in term and len(term) > 3 and term not in STOPWORDS
