#!/usr/bin/env python3
"""Show a bunny job the work already done on its screen, before it starts.

Usage: tools/bunny_prior_work.py PLAN WORKTREE

Why: jobs were planned and run for screens that were already finished, and a
research job decoded a routine an earlier report had already decoded. The
launcher (~/bin/bunny) runs this before it takes a slot.

A plan names its screen on one line:  SCREEN: Battle TECH list
and may name extra reports to copy:   PRIOR: s820-report.md
This tool then:
  - refuses (exit 3) when another running job names the same screen;
  - finds the progress-list items, recent commits and earlier reports
    (.bunny-scratch/*-report.md in the main checkout) that share the screen's words;
  - copies those reports into WORKTREE/.bunny-scratch/prior/ (a bunny cannot read
    outside its worktree);
  - prints a PRIOR WORK section, which the launcher appends to the plan.
Exit 2 when the plan has no SCREEN line. BUNNY_FORCE=1 skips both refusals.
"""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

MAIN = Path(__file__).resolve().parent.parent
ACTIVE = Path.home() / ".cache" / "bunny-plans" / "active"
STOP = {"the", "and", "with", "from", "that", "this", "screen", "screens", "list", "lists",
        "field", "battle", "original", "port", "decode", "walker", "menu", "menus"}


def stem(w):
    return w[:-1] if len(w) > 4 and w.endswith("s") else w


def words(text, stop=STOP):
    return {stem(w) for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) >= 3 and w not in stop}


def hits(text, keys, need):
    return len(keys & words(text)) >= need


def main():
    plan, worktree = Path(sys.argv[1]), Path(sys.argv[2])
    force = os.environ.get("BUNNY_FORCE") == "1"
    m = re.search(r"^SCREEN:\s*(.+)$", plan.read_text(), re.M)
    if not m:
        print("bunny: the plan has no 'SCREEN: <name>' line; name the screen so earlier work "
              "can be found (BUNNY_FORCE=1 to skip).", file=sys.stderr)
        return 0 if force else 2
    screen = m.group(1).strip()
    keys = words(screen)
    need = 1 if len(keys) <= 2 else 2

    clash = []
    for f in ACTIVE.glob("*.screen") if ACTIVE.exists() else []:
        other = f.read_text().strip()
        if other.lower() == screen.lower():
            clash.append(f"{f.stem}: {other}")
    if clash and not force:
        print(f"bunny: another running job already works on '{screen}': {clash}. "
              "Wait for it, or BUNNY_FORCE=1.", file=sys.stderr)
        return 3

    out = [f"PRIOR WORK on '{screen}' (found by tools/bunny_prior_work.py). Read it first; "
           "do not redo what it already settles, and say where you disagree with it."]
    prog = json.loads((MAIN / "data/screen_progress.json").read_text())
    items = []
    for part in ("done", "inProgress", "next", "open"):
        for x in prog.get(part, []):
            text = x if isinstance(x, str) else " ".join(str(v) for v in x.values())
            if hits(text, keys, need):
                items.append(f"- [{part}] {text[:400]}")
    if items:
        out += ["", "Progress list (data/screen_progress.json):", *items]

    log = subprocess.run(["git", "-C", str(MAIN), "log", "--format=%h %s", "-400"],
                         capture_output=True, text=True).stdout.splitlines()
    # Commits: every word of the screen's name must appear, the generic ones too
    # ("battle", "field"), or a one-word name like "ITEM" matches unrelated work.
    strict = words(screen, stop={"the", "and", "with", "from", "that", "this", "screen", "list"})
    commits = [f"- {c}" for c in log if strict <= words(c, stop=set())][:15]
    if commits:
        out += ["", "Commits (git show <hash> for the detail):", *commits]

    reports = []
    scratch = MAIN / ".bunny-scratch"
    for r in sorted(scratch.glob("*-report.md")) if scratch.exists() else []:
        head = r.name + " " + "\n".join(r.read_text(errors="replace").splitlines()[:25])
        if hits(head, keys, need):
            reports.append(r)
    # A plan can name reports the word match misses:  PRIOR: s820-report.md
    for name in re.findall(r"^PRIOR:\s*(\S+)$", plan.read_text(), re.M):
        r = scratch / name
        if r.exists() and r not in reports:
            reports.append(r)
        elif not r.exists():
            print(f"bunny: PRIOR report {name} is not in {scratch}", file=sys.stderr)
    if reports:
        dest = worktree / ".bunny-scratch" / "prior"
        dest.mkdir(parents=True, exist_ok=True)
        for r in reports:
            if r.parent.resolve() != dest.resolve():
                shutil.copy2(r, dest / r.name)
        out += ["", "Earlier reports, copied into .bunny-scratch/prior/ in your worktree:",
                *[f"- .bunny-scratch/prior/{r.name}" for r in reports]]

    if len(out) == 1:
        out.append("(nothing found)")
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
