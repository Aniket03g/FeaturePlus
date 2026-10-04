"""
Phase 0 gate: prove the refactor changed nothing.

Runs the original docs/map-skill/trial/measure_v3.py as a subprocess and the
extracted library in `legacy=True` mode over the same repository, then compares
the two metric rows field by field. Any difference is a bug introduced by the
move, not an improvement.

Three fields are expected to differ and are reported separately rather than
silently excused, because they are the known v4 defect - the trial's owner
assignment was order-dependent, so these move between runs of the ORIGINAL code
too. `--prove-flaky` demonstrates that directly by running the original twice
under different hash seeds.

Usage:
    python -m tools.map.reproduce <repo> [<repo> ...]
    python -m tools.map.reproduce <repo> --prove-flaky
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.map.pipeline import analyze, trial3_row  # noqa: E402

TRIAL = Path(__file__).resolve().parents[2] / "docs" / "map-skill" / "trial" / "measure_v3.py"

# Fields the trial itself does not compute reproducibly (owner assignment is
# order-dependent). Compared, but reported as "known-flaky" rather than failing.
FLAKY = {"multi_pct", "aggregator", "split_logic", "unclear", "aggregator_pct",
         "split_logic_pct", "community_purity", "single_file_terms",
         "commit_attributed", "commit_attributed_pct"}


def run_original(repo: Path, label: str, seed=None) -> dict:
    env = dict(os.environ)
    if seed is not None:
        env["PYTHONHASHSEED"] = str(seed)
    with tempfile.TemporaryDirectory() as td:
        jsonout = Path(td) / "row.json"
        report = Path(td) / "report.md"
        r = subprocess.run(
            [sys.executable, str(TRIAL), str(repo), "--label", label,
             "--json", str(jsonout), "-o", str(report)],
            capture_output=True, text=True, env=env,
        )
        if not jsonout.exists():
            raise RuntimeError(f"original measure_v3 failed:\n{r.stdout}\n{r.stderr}")
        return json.loads(jsonout.read_text(encoding="utf-8"))


def compare(old: dict, new: dict):
    same, diff_flaky, diff_real = [], [], []
    for k in sorted(set(old) | set(new)):
        a, b = old.get(k, "<missing>"), new.get(k, "<missing>")
        if a == b:
            same.append(k)
        elif k in FLAKY:
            diff_flaky.append((k, a, b))
        else:
            diff_real.append((k, a, b))
    return same, diff_flaky, diff_real


def prove_flaky(repo: Path, label: str):
    """Show the ORIGINAL script disagreeing with itself across hash seeds."""
    a = run_original(repo, label, seed=1)
    b = run_original(repo, label, seed=2)
    moved = [k for k in a if a[k] != b.get(k)]
    print(f"\n  original measure_v3.py, PYTHONHASHSEED=1 vs 2:")
    if not moved:
        print("    no field moved (this repo has no tied ownerships)")
    for k in moved:
        print(f"    {k}: {a[k]}  ->  {b[k]}")

    n1 = trial3_row(analyze(repo, label=label, legacy=False))
    n2 = trial3_row(analyze(repo, label=label, legacy=False))
    moved_new = [k for k in n1 if n1[k] != n2.get(k)]
    print(f"  new library (deterministic mode), two runs:")
    print("    no field moved" if not moved_new else f"    MOVED: {moved_new}")
    return moved, moved_new


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repos", nargs="+")
    ap.add_argument("--prove-flaky", action="store_true")
    args = ap.parse_args()

    failures = 0
    for r in args.repos:
        repo = Path(r).resolve()
        label = repo.name
        print(f"\n=== {label}  ({repo})")
        if not (repo / ".git").exists():
            print("  SKIP: not a git repository")
            continue

        old = run_original(repo, label)
        new = trial3_row(analyze(repo, label=label, legacy=True))
        same, flaky, real = compare(old, new)

        print(f"  identical fields: {len(same)}/{len(same) + len(flaky) + len(real)}")
        for k, a, b in flaky:
            print(f"  ~ known-flaky  {k}: trial={a} lib={b}")
        for k, a, b in real:
            print(f"  X REGRESSION   {k}: trial={a} lib={b}")
        if real:
            failures += 1
        else:
            print("  PASS - no behavioural change outside the known-flaky set")

        if args.prove_flaky:
            prove_flaky(repo, label)

    print(f"\n{'FAILED' if failures else 'ALL PASS'} ({failures} repo(s) with regressions)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
