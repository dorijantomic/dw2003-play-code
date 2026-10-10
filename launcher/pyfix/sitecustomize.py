"""Loaded by every build process the launcher starts (via PYTHONPATH).

On Windows, text files written in text mode get CRLF line endings, so the
generated JSON/TOML/.s files would differ from a Linux build (and byod's
byte-faithful files would not match). Default writes to LF instead; reads keep
universal newlines. A no-op on Linux and macOS.
"""
import builtins
import io
import os

if os.name == "nt":
    _open = io.open

    def _lf_open(file, mode="r", buffering=-1, encoding=None, errors=None, newline=None,
                 closefd=True, opener=None):
        if newline is None and "b" not in mode and any(c in mode for c in "wax"):
            newline = "\n"
        return _open(file, mode, buffering, encoding, errors, newline, closefd, opener)

    builtins.open = _lf_open
    io.open = _lf_open
