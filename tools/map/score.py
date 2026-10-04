"""
Score a map run against a hand-labelled answer key.

    python -m tools.map.score <map-json> <key-csv>

The key's feature vocabulary is the truth. A predicted term is credited when it
is an accepted alias of the key's feature (ALIASES), because the engine emits raw
vocabulary and merging synonyms is the model's job downstream - `account` and
`token` are the `user` feature under different words, and counting them as wrong
would be measuring the naming step, not the mapping step. They are reported
separately as "split" so both numbers are visible.
"""
import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

# Default synonyms, used when a key file declares none of its own. A key can add
# or override these with `# alias: login=security` lines in its header, because
# which words are synonyms is a fact about the repo, not about the scorer.
ALIASES = {"account": "user", "token": "user", "verification": "verify"}


def load_key(p):
    """Returns (labels, aliases). Lines starting `#` are comments; `# alias: a=b`
    declares that the engine's raw term `a` means the key's feature `b`."""
    key, aliases = {}, dict(ALIASES)
    lines = Path(p).read_text(encoding="utf-8").splitlines()
    for l in lines:
        m = re.match(r"#\s*alias:\s*([\w-]+)\s*=\s*([\w-]+)\s*$", l)
        if m:
            aliases[m.group(1)] = m.group(2)
    for row in csv.DictReader(l for l in lines if not l.startswith("#")):
        key[row["file_path"]] = row["feature"]
    return key, aliases


def main():
    mapjson, keycsv = sys.argv[1], sys.argv[2]
    d = json.loads(Path(mapjson).read_text(encoding="utf-8"))
    key, aliases = load_key(keycsv)

    pred = {}
    for f in d["features"]:
        for fl in f["files"]:
            pred[fl["path"]] = (f["term"], fl["confidence"])

    exact = split = wrong = 0
    wrong_rows, plumbing_leak = [], []
    for path, (term, conf) in sorted(pred.items()):
        truth = key.get(path)
        if truth is None:
            continue
        if term == truth:
            exact += 1
        elif aliases.get(term) == truth:
            split += 1
        else:
            wrong += 1
            wrong_rows.append((path, term, truth, conf))
            if truth == "plumbing":
                plumbing_leak.append((path, term))

    scored = exact + split + wrong
    print(f"scored rows: {scored} of {len(pred)} predicted ({len(key)} in key)")
    print(f"  exact      {exact:3}  ({exact/scored:.0%})")
    print(f"  split name {split:3}  ({split/scored:.0%})   right feature, wrong word")
    print(f"  wrong      {wrong:3}  ({wrong/scored:.0%})")
    print(f"  -> on the right feature: {(exact+split)/scored:.0%}")

    print(f"\n  of the {wrong} wrong, {len(plumbing_leak)} are plumbing files that should own no feature")
    real = [r for r in wrong_rows if r[2] != "plumbing"]
    print(f"  genuine feature-to-feature mix-ups: {len(real)}")
    for path, term, truth, conf in real:
        print(f"    {path:58} said {term:13} key {truth:12} conf {conf:.2f}")

    missed = [p for p in key if p not in pred and key[p] != "plumbing"]
    print(f"\n  feature files the map never placed: {len(missed)}")
    for p in sorted(missed):
        print(f"    {p:58} key {key[p]}")

    print("\n  per key-feature recall:")
    for feat, total in sorted(Counter(v for v in key.values()).items()):
        got = sum(1 for p, t in key.items() if t == feat and p in pred
                  and (pred[p][0] == feat or aliases.get(pred[p][0]) == feat))
        print(f"    {feat:13} {got:3}/{total:<3} {got/total:.0%}")


if __name__ == "__main__":
    main()
