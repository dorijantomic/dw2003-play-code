#!/usr/bin/env python3
"""build_engine.py — produce the committed browser engine artifacts.

Two outputs, both committed (build_all is the source of truth):
  - web/vendor/engine.js          : esbuild bundle of engine/index.ts (ESM, types stripped).
                                    Production; the ordinary page loads it eagerly and it
                                    must carry NO PlayStation interpreter.
  - web/vendor/engine-native.js   : esbuild bundle of engine/native-entry.ts. Research-only;
                                    the interpreter + mixed-mode bridge, fetched only through
                                    a dynamic import (web/native-runtime.js).
  - web/assets/engine-content.json : the EngineContent blob (stages + ordinal + roster +
                                     flagKeys) the browser fetches, via tools/engine-convert/convert.ts

Node + esbuild are dev/build-time tools (esbuild is an npm devDependency); the browser game
ships zero runtime dependencies. Run standalone or as the `engine_bundle` build_all stage.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ESBUILD = ROOT / "node_modules" / "esbuild" / "bin" / "esbuild"


def run(cmd):
    print("+", " ".join(str(c) for c in cmd))
    rc = subprocess.call(cmd, cwd=str(ROOT))
    if rc != 0:
        sys.exit(rc)


def main():
    if not ESBUILD.exists():
        sys.exit("esbuild not found — run `npm install` first (devDependency esbuild).")
    (ROOT / "web" / "vendor").mkdir(parents=True, exist_ok=True)
    # 1) bundle the TS engine to two browser ESM modules: the production barrel
    #    (no interpreter) and the research-only interpreter entry.
    run(["node", str(ESBUILD), "engine/index.ts", "--bundle", "--format=esm",
         "--outfile=web/vendor/engine.js"])
    run(["node", str(ESBUILD), "engine/native-entry.ts", "--bundle", "--format=esm",
         "--outfile=web/vendor/engine-native.js"])
    # 2) convert extracted assets -> the EngineContent blob the browser loads
    run(["node", "tools/engine-convert/convert.ts"])
    print("engine artifacts built: web/vendor/engine.js + web/vendor/engine-native.js + web/assets/engine-content.json")


if __name__ == "__main__":
    main()
