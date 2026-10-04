"""
Are two signals actually telling us different things?

v2 had a corroboration rule - "a term seen by two signals is real" - and it
inverted on the vibecoded sample. Trial 3 found the cause: pages and routes are
the same fact counted twice. Route terms were 79-100% derivable from page
filenames (Grove's 0% was a one-repo accident), so requiring both proved
nothing and mostly filtered out real features.

The conclusion carried into the mapper is that signals must be grouped into
*classes* and only cross-class agreement counts as independent evidence. The
mapper does not use this to gate a term - gating is what failed - but to weight
it: agreement across two independent classes is worth more than the same term
appearing twice inside one class.
"""

import re

from .names import layout_tokens


def derivation_rate(child_vocab, parent_tokens):
    """
    What share of `child_vocab` could have been read straight off the parent's
    filenames? If a route term is just the page file's name, the two signals
    are one signal counted twice and corroborating them proves nothing.
    """
    if not child_vocab:
        return 0.0
    derivable = sum(1 for v in child_vocab if v in parent_tokens)
    return derivable / len(child_vocab)


def signal_classes(page_vocab, route_vocab, schema_vocab, cfg_vocab,
                   commit_vocab, dir_vocab, files):
    """
    Group raw signals into classes that are plausibly independent, then measure
    whether they really are.

    Everything read off the source layout is one class, because in an SPA the
    router points at the pages that live in the dirs. Schema and history are
    separate classes because neither is derivable from the file tree - which is
    the property the derivability numbers below are checking, not assuming.
    """
    raw = {
        "pages": page_vocab, "routes": route_vocab, "dirnames": dir_vocab,
        "schema": schema_vocab, "config": cfg_vocab, "commits": commit_vocab,
    }
    classes = {
        "code-layout": page_vocab | route_vocab | dir_vocab,
        "schema": schema_vocab | cfg_vocab,
        "history": commit_vocab,
    }
    tokens = layout_tokens(files)
    # Same predicate the trial used, kept as a regex so the set of "page files"
    # is identical: the segment must be a directory, not a filename.
    page_dirs = [f for f in files if re.search(r"(^|/)(pages|views|screens)/", f)]
    page_tokens = layout_tokens(page_dirs)
    dr = {
        "routes<-pages": derivation_rate(route_vocab, page_tokens),
        "commits<-layout": derivation_rate(commit_vocab, tokens),
        "schema<-layout": derivation_rate(schema_vocab, tokens),
    }
    live = {k: v for k, v in classes.items() if v}
    return raw, live, dr


def class_agreement(term, classes):
    """How many independent signal classes name this term."""
    return sum(1 for v in classes.values() if term in v)
