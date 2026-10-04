"""
Reading the repository: file discovery, file contents, and git history.

Moved verbatim out of measure_v2.py / measure_v3.py. Everything here is
read-only - nothing in tools/map ever writes into a target repo.

Only tracked files are ever considered, which is what keeps node_modules, dist
and build output out of every measurement for free: if git ignores it, we never
see it.
"""

import collections
import os
import re
import subprocess
from pathlib import Path

SOURCE_EXT = {".go", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".astro",
              ".vue", ".svelte", ".py", ".rb", ".java",
              # Elixir/Phoenix. .heex is the template half of a LiveView and
              # carries the feature word as often as the .ex beside it.
              ".ex", ".exs", ".heex",
              # C#/.NET. .cshtml and .razor are the view halves of ASP.NET.
              ".cs", ".cshtml", ".razor"}

# Directories that hold vendored library code rather than application code.
VENDOR_HINTS = ("src/components/ui/", "components/ui/", "src/ui/primitives/")


def run_git(repo: Path, *args: str) -> str:
    out = subprocess.run(
        ["git", *args], cwd=str(repo), capture_output=True, text=True, errors="replace"
    )
    if out.returncode != 0:
        return ""
    return out.stdout


def is_vendor(path: str) -> bool:
    # A path segment literally named `vendor` is the near-universal convention
    # (Go modules, Phoenix's assets/vendor, Rails). The hints above are the
    # framework-specific cases that don't say so in the path.
    if "vendor" in path.split("/")[:-1]:
        return True
    return any(h in path for h in VENDOR_HINTS)


def source_files(repo: Path):
    """Tracked source files only - git handles node_modules/dist/vendor for us."""
    files = []
    for line in run_git(repo, "ls-files").splitlines():
        line = line.strip()
        if not line:
            continue
        if Path(line).suffix.lower() in SOURCE_EXT:
            files.append(line)
    return sorted(files)


def sql_files(repo: Path):
    return sorted(
        line.strip() for line in run_git(repo, "ls-files").splitlines()
        if line.strip().lower().endswith(".sql")
    )


def subtree_of(path: str) -> str:
    """Top-level directory, used to report each half of a repo separately."""
    parts = path.split("/")
    return parts[0] if len(parts) > 1 else "(root)"


def read_text(repo: Path, rel: str) -> str:
    try:
        return (repo / rel).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def go_module_name(repo: Path):
    for gomod in repo.rglob("go.mod"):
        if "node_modules" in gomod.parts:
            continue
        for line in gomod.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("module "):
                root = str(gomod.parent.relative_to(repo)).replace("\\", "/")
                return line.split()[1], ("" if root == "." else root)
    return None, ""


# ------------------------------------------------------------------- history


def parse_log(repo: Path, tracked):
    """One pass over history, shared by every history-derived signal."""
    log = run_git(
        repo, "log", "--name-only", "--pretty=format:@@%H|%an|%ae|%s", "--no-merges"
    )
    tracked_set = set(tracked)
    commits = []
    cur = None
    for line in log.splitlines():
        if line.startswith("@@"):
            if cur:
                commits.append(cur)
            parts = line[2:].split("|", 3)
            cur = {
                "sha": parts[0],
                "author": parts[1] if len(parts) > 1 else "",
                "email": parts[2] if len(parts) > 2 else "",
                "subject": parts[3] if len(parts) > 3 else "",
                "files": [],      # tracked source files only
                "all_files": 0,   # every path in the commit
            }
        elif cur is not None:
            f = line.strip().replace("\\", "/")
            if not f:
                continue
            cur["all_files"] += 1
            if f in tracked_set:
                cur["files"].append(f)
    if cur:
        commits.append(cur)
    return commits


def log_with_root(repo: Path, tracked):
    """
    Same shape as parse_log, but includes the root commit.

    `git log --name-only` lists no files for the initial commit unless --root is
    given. That matters for vendored-code detection because the vendored UI kit
    arrives in exactly that commit - on games-website the root commit adds 661
    files, the shadcn set among them, and none is ever touched again. parse_log
    is left alone so the v2 measures stay byte-comparable; this gets its own pass.
    """
    log = run_git(repo, "log", "--root", "--name-only",
                  "--pretty=format:@@%H|%an|%ae|%s", "--no-merges")
    tracked_set = set(tracked)
    commits, cur = [], None
    for line in log.splitlines():
        if line.startswith("@@"):
            if cur:
                commits.append(cur)
            parts = line[2:].split("|", 3)
            cur = {"sha": parts[0], "subject": parts[3] if len(parts) > 3 else "",
                   "files": []}
        elif cur is not None:
            f = line.strip().replace("\\", "/")
            if f and f in tracked_set:
                cur["files"].append(f)
    if cur:
        commits.append(cur)
    return commits


def pct(n, d):
    return f"{(100.0 * n / d):.1f}%" if d else "n/a"
