#!/usr/bin/env python3
"""Digimon World 2003 — one-click launcher.

Starts a small web server on this computer and opens the browser. The first
time, the page asks for your own copy of the game (a PAL/EU disc image); the
launcher then builds the game's assets from that disc, on this computer, and
starts the game. Every later launch goes straight to the game.

Nothing from the game is bundled or downloaded: the assets are decoded from the
disc you provide. What is downloaded once is Marko's (markisha64/ddw3) public
source text — the assembly/table files the build reads alongside the disc
(~11 MB, LFS game data excluded).

Runs from the packaged release (bundle/app + bundle/runtime) or from a source
checkout (`python3 launcher/dw2003.py`, with the tools on PATH / in env vars).

    dw2003.py                      start (setup page on first run, then the game)
    dw2003.py --disc PATH          build from this disc without the setup page
    dw2003.py --no-serve           build only (with --disc), then exit
    dw2003.py --port N             serve on port N (default 20030)
    dw2003.py --data-dir DIR       where the game is built (default: per-user app data)
    dw2003.py --rebuild            forget the previous build and start over
    dw2003.py --no-browser         do not open a browser window

Stdlib only: it must run on the bundled interpreter before anything is set up.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import threading
import time
import traceback
import urllib.parse
import urllib.request
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP_SRC = HERE.parent                      # the repository / bundle "app" dir
BUNDLE = APP_SRC.parent                    # bundle root when packaged
RUNTIME = BUNDLE / "runtime"
PACKAGED = (RUNTIME / "bin").is_dir()

DEFAULT_PORT = 20030
DDW3_URL = "https://codeload.github.com/markisha64/ddw3/tar.gz/{ref}"
# The ddw3 commit this tree is tested against (same pin as install-play.sh).
DDW3_REF = os.environ.get("DDW3_REF", "b125b3d7471c23d305b27f0b1d7a2353643a3ee3")
# Paths of the ddw3 source the build reads next to the disc (plain text, no LFS).
DDW3_DIRS = ("asm/", "rust/")
DDW3_FILES = ("tools/util.py", "tools/stitch-map.py",
              "tools/ddw3-lang-file/src/codepoint.rs",
              "iso/dw2003-bootstrap/lbas.toml", "data/digimon_profiles.toml")
EXTRACTORS = ("unpack", "unmap", "unrlen", "unmap-tile", "untim", "unlang-file", "ddw3-unvab-sep")
# Files a finished build must have produced (same check as install-play.sh).
BUILD_OUTPUTS = ("web/assets/manifest.json", "web/assets/maps/s200.png",
                 "web/assets/native/screens/resident.bin", "web/vendor/engine.js")
EXE = ".exe" if os.name == "nt" else ""


def version() -> str:
    try:
        return (APP_SRC / "launcher" / "VERSION").read_text().strip()
    except OSError:
        return "dev"


def default_data_dir() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData/Local")
        return base / "DW2003"
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/DW2003"
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share") / "dw2003"


# --- tools -------------------------------------------------------------------

def find_tools() -> dict:
    """Locate the external programs the build runs; packaged first, then env/PATH."""
    t = {"python": sys.executable}
    if PACKAGED:
        bin_dir = RUNTIME / "bin"
        t["extractors"] = bin_dir
        t["objdump"] = bin_dir / f"mips-elf-objdump{EXE}"
        t["fluidsynth"] = bin_dir / f"fluidsynth{EXE}"
        node_dir = RUNTIME / "node" if os.name == "nt" else RUNTIME / "node/bin"
        t["path"] = [str(bin_dir), str(node_dir)]
    else:
        cache = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "dw2003-play"
        t["extractors"] = Path(os.environ.get("BYOD_DDW3_TOOLS") or cache / "ddw3-tools")
        od = (os.environ.get("OBJDUMP") or shutil.which("mipsel-linux-gnu-objdump")
              or shutil.which("mips-elf-objdump"))
        if not od:
            cand = cache / "toolchain/binutils/bin/mips-elf-objdump"
            od = str(cand) if cand.exists() else ""
        t["objdump"] = Path(od) if od else None
        fs = os.environ.get("FLUIDSYNTH") or shutil.which("fluidsynth")
        t["fluidsynth"] = Path(fs) if fs else None
        t["path"] = []
    return t


def self_test() -> int:
    """Check that this install can build: tools present and runnable, packages importable."""
    t = find_tools()
    problems = check_tools(t)
    env = dict(os.environ)
    env["PATH"] = os.pathsep.join(t["path"] + [env.get("PATH", "")])
    checks = [[str(t["objdump"]), "--version"], ["node", "--version"],
              [sys.executable, "-c", "import PIL, numpy, toml, capstone, mido, soundfile, "
               "pycparser, imageio_ffmpeg; print('ffmpeg', imageio_ffmpeg.get_ffmpeg_exe())"]]
    if t.get("fluidsynth"):
        checks.append([str(t["fluidsynth"]), "--version"])
    for cmd in checks:
        exe = shutil.which(cmd[0], path=env["PATH"]) or cmd[0]
        try:
            r = subprocess.run([exe, *cmd[1:]], capture_output=True, text=True, env=env, timeout=60)
            first = (r.stdout or r.stderr).strip().splitlines()[:1]
            print(f"  {Path(cmd[0]).name}: {'ok' if r.returncode == 0 else 'FAILED'} {first[0] if first else ''}")
            if r.returncode != 0:
                problems.append(f"{cmd[0]} failed: {r.stderr.strip()[:300]}")
        except OSError as e:
            problems.append(f"{cmd[0]}: {e}")
    for p in problems:
        print("  PROBLEM:", p)
    print("self-test", "OK" if not problems else "FAILED")
    return 0 if not problems else 1


def check_tools(t: dict) -> list:
    problems = []
    for name in EXTRACTORS:
        if not (t["extractors"] / f"{name}{EXE}").exists():
            problems.append(f"missing extractor {name} in {t['extractors']}")
    if not t["objdump"] or not Path(t["objdump"]).exists():
        problems.append("missing mips objdump (set OBJDUMP)")
    env_path = os.pathsep.join(t["path"] + [os.environ.get("PATH", "")])
    if not shutil.which("node", path=env_path):
        problems.append("missing node (Node.js 18+)")
    return problems


# --- the build -----------------------------------------------------------------

class Build:
    """Disc -> data tree -> browser assets, run step by step in a worker thread."""

    STEPS = [  # key, label, share of the progress bar
        ("check", "Checking your disc", 1),
        ("source", "Downloading the decompilation's source text", 2),
        ("decode", "Decoding your disc", 12),
        ("asm", "Rebuilding the game code listings", 8),
        ("assets", "Building the game's assets", 77),
    ]

    def __init__(self, data: Path, tools: dict, app: Path):
        self.data = data
        self.tools = tools
        self.app = app
        self.tree = data / "tree"
        self.src = data / "ddw3-src"
        self.disc = data / "disc" / "dw2003.bin"
        self.state_file = data / "state.json"
        self.lock = threading.Lock()
        self.state = "need-disc"     # need-disc | receiving | building | done | failed
        self.step = ""
        self.step_frac = 0.0
        self.error = ""
        self.log_lines: list[str] = []
        self.started = 0.0
        self.thread = None
        saved = self._load()
        if saved.get("built") == version() and self._outputs_ok():
            self.state = "done"
        elif saved.get("disc") and Path(saved["disc"]).is_file():
            self.disc = Path(saved["disc"])

    # state persistence ---------------------------------------------------------
    def _load(self) -> dict:
        try:
            return json.loads(self.state_file.read_text())
        except (OSError, ValueError):
            return {}

    def _save(self, **kw):
        d = self._load()
        d.update(kw)
        self.data.mkdir(parents=True, exist_ok=True)
        self.state_file.write_text(json.dumps(d, indent=1))

    def _outputs_ok(self) -> bool:
        return all((self.app / f).is_file() for f in BUILD_OUTPUTS)

    # status for the setup page -------------------------------------------------
    def status(self) -> dict:
        with self.lock:
            done = 0.0
            for key, _label, share in self.STEPS:
                if key == self.step:
                    done += share * self.step_frac
                    break
                done += share
            if self.state == "done":
                done = 100.0
            elif self.state in ("need-disc", "receiving"):
                done = 0.0
            label = dict((k, l) for k, l, _ in self.STEPS).get(self.step, "")
            return {"state": self.state, "step": self.step, "label": label,
                    "progress": round(done, 1), "error": self.error,
                    "elapsed": int(time.time() - self.started) if self.started else 0,
                    "log": self.log_lines[-60:], "version": version(),
                    "has_disc": self.disc.is_file()}

    def log(self, line: str):
        line = line.rstrip()
        with self.lock:
            self.log_lines.append(line)
            if len(self.log_lines) > 2000:
                del self.log_lines[:1000]
        print(line, flush=True)
        try:
            with open(self.data / "build.log", "a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            pass

    def _set(self, **kw):
        with self.lock:
            for k, v in kw.items():
                setattr(self, k, v)

    # entry points ----------------------------------------------------------------
    def start(self):
        with self.lock:
            if self.state == "building":
                return
            self.state, self.error, self.started = "building", "", time.time()
            self.log_lines = []
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self):
        try:
            (self.data / "build.log").unlink(missing_ok=True)
            self.log(f"DW2003 launcher {version()} — {platform.platform()}")
            self.log(f"build folder: {self.data}")
            self._check()
            self._source()
            self._decode()
            self._asm()
            self._assets()
            self._save(built=version(), disc=str(self.disc))
            self._set(state="done", step="", step_frac=1.0)
            self.log("Build complete.")
        except Exception as e:  # surface every failure on the page
            msg = str(e) if isinstance(e, BuildError) else f"{type(e).__name__}: {e}"
            if not isinstance(e, BuildError):
                self.log(traceback.format_exc())
            self.log(f"ERROR: {msg}")
            self._set(state="failed", error=msg)

    # steps -------------------------------------------------------------------------
    def _check(self):
        self._set(step="check", step_frac=0.0)
        problems = check_tools(self.tools)
        if problems:
            raise BuildError("this install is incomplete: " + "; ".join(problems))
        if not self.disc.is_file():
            raise BuildError("no disc image was given")
        err = check_disc(self.disc)
        if err:
            raise BuildError(err)
        self.log(f"disc OK: {self.disc}")
        self._prepare_app()

    def _prepare_app(self):
        """Give the build a writable copy of the game code (the install dir may be read-only)."""
        if self.app.resolve() == APP_SRC.resolve():
            return
        stamp = self.app / "launcher" / "VERSION"
        if stamp.is_file() and stamp.read_text().strip() == version() and version() != "dev":
            return
        self.log("copying the game code into the build folder")
        if self.app.exists():
            shutil.rmtree(self.app)
        shutil.copytree(APP_SRC, self.app, ignore=shutil.ignore_patterns(
            ".git", "__pycache__", "build", ".venv"))

    def _source(self):
        self._set(step="source", step_frac=0.0)
        marker = self.src / ".ref"
        if marker.is_file() and marker.read_text().strip() == DDW3_REF:
            self.log("ddw3 source text already downloaded")
            return
        url = DDW3_URL.format(ref=DDW3_REF)
        self.log(f"downloading {url}")
        self.log("credit: Marko (markisha64/ddw3) — his decompilation and extractors make this possible")
        if self.src.exists():
            shutil.rmtree(self.src)
        tmp = self.src.with_name("ddw3-src.part")
        if tmp.exists():
            shutil.rmtree(tmp)
        tmp.mkdir(parents=True)
        buf = io.BytesIO()
        req = urllib.request.Request(url, headers={"User-Agent": "dw2003-launcher"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                total = int(r.headers.get("Content-Length") or 12_000_000)
                while chunk := r.read(1 << 16):
                    buf.write(chunk)
                    self._set(step_frac=min(0.9, buf.tell() / total))
        except OSError as e:
            raise BuildError(f"could not download the ddw3 source text ({e}). "
                             "Check your internet connection and try again.")
        buf.seek(0)
        n = 0
        with tarfile.open(fileobj=buf, mode="r:gz") as tf:
            for m in tf:
                rel = m.name.split("/", 1)[1] if "/" in m.name else ""
                if not m.isfile() or not (rel.startswith(DDW3_DIRS) or rel in DDW3_FILES):
                    continue
                dest = tmp / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                with tf.extractfile(m) as fh, open(dest, "wb") as out:
                    shutil.copyfileobj(fh, out)
                n += 1
        missing = [f for f in DDW3_FILES if not (tmp / f).is_file()]
        if missing or not (tmp / "asm/dw2003").is_dir():
            raise BuildError(f"the ddw3 source download is incomplete (missing {missing or 'asm/'})")
        tmp.rename(self.src)
        marker.write_text(DDW3_REF)
        self.log(f"ddw3 source text: {n} files")

    def _decode(self):
        self._set(step="decode", step_frac=0.0)
        marker = self.tree / ".byod-tree-ok"
        disc_id = _disc_id(self.disc)
        if marker.is_file() and marker.read_text() == f"{disc_id}|{version()}":
            self.log("disc already decoded")
            return
        if self.tree.exists():
            shutil.rmtree(self.tree)
        self.tree.mkdir(parents=True)
        self._py(["tools/byod/byod.py", str(self.disc), "--out", str(self.tree),
                  "--tools", str(self.tools["extractors"])],
                 progress=_byod_progress)

    def _asm(self):
        self._set(step="asm", step_frac=0.0)
        marker = self.tree / ".byod-tree-ok"
        disc_id = _disc_id(self.disc)
        if marker.is_file() and marker.read_text() == f"{disc_id}|{version()}":
            return
        self._py(["tools/byod/byod_asm.py", "--staging", str(self.tree / "_disc"),
                  "--objdump-bin", str(self.tools["objdump"]), "--ddw3", str(self.src),
                  "--out", str(self.tree), "--report", str(self.tree / "_work/asm_report.json")])
        self.log("copying the support files from the ddw3 source text")
        shutil.copytree(self.src / "rust", self.tree / "rust", dirs_exist_ok=True)
        for rel in DDW3_FILES:
            dest = self.tree / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(self.src / rel, dest)
        portable_stitcher(self.tree / "tools")
        marker.write_text(f"{disc_id}|{version()}")

    def _assets(self):
        self._set(step="assets", step_frac=0.0)
        for f in BUILD_OUTPUTS:  # a half-finished earlier build must not count as done
            (self.app / f).unlink(missing_ok=True)
        self._py(["build_all.py", "--skip", "ddw3_disc"], progress=_stage_progress)
        missing = [f for f in BUILD_OUTPUTS if not (self.app / f).is_file()]
        if missing:
            raise BuildError(f"the build finished but {missing[0]} is missing; see build.log")

    def _env(self) -> dict:
        env = dict(os.environ)
        env.update({
            "PYTHONUTF8": "1", "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8",
            "DDW3_DIR": str(self.tree), "DW3_DISC": str(self.disc),
            "DW2003_PYTHON": self.tools["python"],
            "BYOD_DDW3_TOOLS": str(self.tools["extractors"]),
        })
        if os.name == "nt":  # LF line endings in everything the build writes
            env["PYTHONPATH"] = os.pathsep.join(filter(None, [str(HERE / "pyfix"),
                                                             env.get("PYTHONPATH")]))
        if self.tools.get("fluidsynth"):
            env["FLUIDSYNTH"] = str(self.tools["fluidsynth"])
        if self.tools["path"]:
            env["PATH"] = os.pathsep.join(self.tools["path"] + [env.get("PATH", "")])
        return env

    def _py(self, argv, progress=None):
        cmd = [self.tools["python"], *argv]
        self.log("$ " + " ".join(argv))
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        p = subprocess.Popen(cmd, cwd=self.app, env=self._env(), stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                             errors="replace", bufsize=1, creationflags=flags)
        assert p.stdout is not None
        for line in p.stdout:
            self.log(line)
            if progress:
                f = progress(line)
                if f is not None:
                    self._set(step_frac=f)
        rc = p.wait()
        if rc != 0:
            hint = ""
            if "build_all.py" in argv[0]:
                failed = [l for l in self.log_lines if ": FAILED" in l]
                hint = f" ({failed[0].strip()})" if failed else ""
            raise BuildError(f"{Path(argv[0]).name} stopped with exit code {rc}{hint}; "
                             f"the full log is in {self.data / 'build.log'}")


def portable_stitcher(tools: Path):
    """Make ddw3's map stitcher (tools/util.py + tools/stitch-map.py) path-portable.

    It treats '/'-rooted config paths as relative to the ddw3 root and compares
    path strings against 'build/...', which only holds with POSIX separators
    (its own comment: "TODO: Make this work on windows?"). Same behaviour on
    Linux/macOS; on Windows this is what lets the map stages run at all.
    """
    util = tools / "util.py"
    s = util.read_text(encoding="utf-8")
    s = s.replace('\tif path.is_absolute():\n\t\t# TODO: Make this work on windows?\n\t\treturn path.relative_to("/")',
                  '\tif str(path).replace("\\\\", "/").startswith("/"):\n\t\treturn Path(*path.parts[1:])')
    util.write_text(s, encoding="utf-8", newline="\n")
    sm = tools / "stitch-map.py"
    s = sm.read_text(encoding="utf-8")
    s = re.sub(r"str\((entry_path|map_tim_path)\)", r"\1.as_posix()", s)
    sm.write_text(s, encoding="utf-8", newline="\n")


class BuildError(Exception):
    pass


def _disc_id(p: Path) -> str:
    st = p.stat()
    return f"{st.st_size}:{int(st.st_mtime)}"


def _stage_progress(line: str):
    m = re.match(r"\[(\d+)/(\d+)\]", line)
    return int(m.group(1)) / int(m.group(2)) if m else None


def _byod_progress(line: str):
    m = re.search(r"(\d+)\s*/\s*(\d+)", line)
    if m and int(m.group(2)) > 0:
        return min(1.0, int(m.group(1)) / int(m.group(2)))
    return None


def check_disc(disc: Path) -> str:
    """'' when the image is the supported PAL/EU disc, else a message for the player."""
    sys.path.insert(0, str(APP_SRC / "tools" / "byod"))
    try:
        import byod  # noqa: E402  (stdlib-only)
        byod.check_disc(disc)
    except SystemExit as e:
        msg = str(e.code or "")
        return re.sub(r"\s+", " ", msg.replace("byod: ", "")).strip()
    finally:
        sys.path.pop(0)
    return ""


# --- web server -------------------------------------------------------------------

MIME = {".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
        ".html": "text/html; charset=utf-8", ".css": "text/css", ".png": "image/png",
        ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".wasm": "application/wasm",
        ".mp4": "video/mp4", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".wav": "audio/wav",
        ".mp3": "audio/mpeg", ".bin": "application/octet-stream", ".txt": "text/plain"}


def make_handler(build: Build):
    setup_dir = HERE / "setup"

    class Handler(SimpleHTTPRequestHandler):
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map, **MIME}

        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(build.app / "web"), **kw)

        def log_message(self, fmt, *args):  # keep the console readable
            pass

        def end_headers(self):
            self.send_header("Cache-Control", "no-cache")
            super().end_headers()

        def _json(self, obj, code=200):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _file(self, path: Path):
            data = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", MIME.get(path.suffix, "application/octet-stream"))
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = urllib.parse.urlparse(self.path).path
            if path == "/__dw2003/status":
                return self._json(build.status())
            if path.startswith("/__dw2003/"):
                name = path.rsplit("/", 1)[-1] or "index.html"
                f = setup_dir / name
                if f.is_file() and f.parent == setup_dir:
                    return self._file(f)
                return self.send_error(404)
            if build.state != "done":
                self.send_response(302)
                self.send_header("Location", "/__dw2003/")
                self.end_headers()
                return
            if self.headers.get("Range"):
                return self._range()
            return super().do_GET()

        def _range(self):
            """Byte ranges: Safari will not play the opening movie without them."""
            f = Path(self.translate_path(self.path))
            m = re.match(r"bytes=(\d*)-(\d*)$", self.headers.get("Range", ""))
            if not f.is_file() or not m:
                return super().do_GET()
            size = f.stat().st_size
            if m.group(1):
                start, end = int(m.group(1)), int(m.group(2) or size - 1)
            else:
                start, end = max(0, size - int(m.group(2) or 0)), size - 1
            end = min(end, size - 1)
            if start > end:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            self.send_response(HTTPStatus.PARTIAL_CONTENT)
            self.send_header("Content-Type", self.guess_type(str(f)))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(end - start + 1))
            self.end_headers()
            with open(f, "rb") as fh:
                fh.seek(start)
                left = end - start + 1
                while left > 0 and (chunk := fh.read(min(left, 1 << 16))):
                    self.wfile.write(chunk)
                    left -= len(chunk)

        def do_PUT(self):
            if urllib.parse.urlparse(self.path).path != "/__dw2003/disc":
                return self.send_error(404)
            if build.state == "building":
                return self._json({"error": "a build is already running"}, 409)
            n = int(self.headers.get("Content-Length") or 0)
            if n < 100_000_000:
                self.rfile.read(n)
                return self._json({"error": "That file is too small to be a PS1 disc image "
                                   "(expected about 600-700 MB). If you have a .cue file, "
                                   "choose the .bin file next to it."}, 400)
            dest = build.data / "disc" / "dw2003.bin"
            dest.parent.mkdir(parents=True, exist_ok=True)
            part = dest.with_suffix(".part")
            build._set(state="receiving")
            try:
                with open(part, "wb") as out:
                    left = n
                    while left > 0:
                        chunk = self.rfile.read(min(left, 1 << 20))
                        if not chunk:
                            raise OSError("the upload stopped early")
                        out.write(chunk)
                        left -= len(chunk)
            except OSError as e:
                part.unlink(missing_ok=True)
                build._set(state="need-disc")
                return self._json({"error": f"could not receive the file: {e}"}, 500)
            err = check_disc(part)
            if err:
                part.unlink(missing_ok=True)
                build._set(state="need-disc")
                return self._json({"error": err}, 400)
            os.replace(part, dest)
            build.disc = dest
            build._save(disc=str(dest))
            build.start()
            return self._json({"ok": True})

        def do_POST(self):
            path = urllib.parse.urlparse(self.path).path
            if path == "/__dw2003/retry" and build.disc.is_file():
                build.start()
                return self._json({"ok": True})
            if path == "/__dw2003/forget-disc":
                if build.state != "building":
                    build._set(state="need-disc", error="")
                return self._json({"ok": True})
            return self.send_error(404)

    return Handler


def port_in_use_by_us(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/__dw2003/status", timeout=2) as r:
            return "state" in json.loads(r.read())
    except Exception:
        return False


def serve(build: Build, port: int, open_browser: bool):
    url = f"http://127.0.0.1:{port}/"
    if port_in_use_by_us(port):
        print(f"DW2003 is already running at {url}")
        if open_browser:
            webbrowser.open(url)
        return 0
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(build))
    except OSError as e:
        print(f"ERROR: cannot use port {port} ({e}). Another program is using it; "
              f"start with --port <another number>.")
        return 1
    httpd.daemon_threads = True
    bar = "=" * 64
    print(f"\n{bar}\n  Digimon World 2003 is running.\n\n  Open:  {url}\n\n"
          f"  Keep this window open while you play. Close it to quit.\n{bar}\n", flush=True)
    if open_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Digimon World 2003 launcher")
    ap.add_argument("--disc", help="your PAL/EU disc image (.bin or .iso)")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--data-dir", help="where the game is built (default: per-user app data)")
    ap.add_argument("--no-serve", action="store_true", help="build only, then exit")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--rebuild", action="store_true", help="forget the previous build")
    ap.add_argument("--self-test", action="store_true", help="check this install and exit")
    a = ap.parse_args(argv)
    if a.self_test:
        return self_test()

    if PACKAGED or a.data_dir:
        data = Path(a.data_dir).expanduser().resolve() if a.data_dir else default_data_dir()
    else:
        data = APP_SRC / "build" / "launcher"   # source checkout: build in place
    data.mkdir(parents=True, exist_ok=True)
    # A packaged install builds in a writable copy; a source checkout builds in place.
    app = data / "app" if (PACKAGED or a.data_dir) else APP_SRC
    build = Build(data, find_tools(), app)
    if a.rebuild:
        build._save(built=None)
        build.state = "need-disc"
        shutil.rmtree(build.tree, ignore_errors=True)
    if a.disc:
        build.disc = Path(a.disc).expanduser().resolve()
    if a.disc and build.state != "done" or (a.rebuild and build.disc.is_file()):
        build.start()
        if a.no_serve:
            build.thread.join()
            return 0 if build.state == "done" else 1
    elif a.no_serve:
        print("nothing to do: pass --disc to build" if build.state != "done" else "already built")
        return 0 if build.state == "done" else 1
    return serve(build, a.port, not a.no_browser)


if __name__ == "__main__":
    sys.exit(main())
