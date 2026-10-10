"""Concurrency-safe helpers for shared reverse-engineering metadata."""

from __future__ import annotations

import fcntl
import json
import os
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


DEFAULT_LOCK_TIMEOUT = 30.0


@contextmanager
def file_lock(
    path: Path,
    *,
    shared: bool = False,
    timeout: float = DEFAULT_LOCK_TIMEOUT,
) -> Iterator[None]:
    """Acquire a bounded POSIX advisory lock on ``path``.

    Readers use ``shared=True``; mutation and replacement operations use the
    default exclusive mode.  The lock file is deliberately separate from the
    protected data so replacing that data cannot replace the lock inode.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    operation = fcntl.LOCK_SH if shared else fcntl.LOCK_EX
    started = time.monotonic()
    with path.open("a+") as handle:
        while True:
            try:
                fcntl.flock(handle.fileno(), operation | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() - started >= timeout:
                    mode = "shared" if shared else "exclusive"
                    raise TimeoutError(
                        f"timed out waiting {timeout:g}s for {mode} lock: {path}"
                    )
                time.sleep(0.05)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


@contextmanager
def metadata_lock(root: Path, timeout: float = DEFAULT_LOCK_TIMEOUT) -> Iterator[None]:
    """Hold the repository-wide lock for a complete metadata mutation.

    Atomic replacement prevents torn files, but it does not protect a
    read-modify-write sequence from another process.  Every command that
    changes the ledger, manifests, reviews, or derived index uses this lock.
    """
    with file_lock(root / ".dw3-research/metadata.lock", timeout=timeout):
        yield


@contextmanager
def index_lock(
    root: Path,
    *,
    shared: bool,
    timeout: float = DEFAULT_LOCK_TIMEOUT,
) -> Iterator[None]:
    """Protect the derived SQLite cache across its complete open lifetime."""
    with file_lock(
        root / ".dw3-research/index.lock", shared=shared, timeout=timeout
    ):
        yield


def atomic_json(path: Path, data: dict, *, indent: int | None = None) -> None:
    """Durably replace a JSON file through a unique same-directory temporary."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if indent is None:
        indent = 2
        if path.exists():
            for line in path.read_text().splitlines()[1:]:
                stripped = line.lstrip()
                if stripped and len(line) != len(stripped):
                    indent = len(line) - len(stripped)
                    break

    mode = path.stat().st_mode & 0o777 if path.exists() else 0o644
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            json.dump(data, handle, indent=indent)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
