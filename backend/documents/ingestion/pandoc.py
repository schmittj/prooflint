"""Helpers for locating the pandoc executable used by ingestion."""

from __future__ import annotations

import os
import shutil
import sys
from functools import lru_cache
from pathlib import Path


class PandocResolutionError(RuntimeError):
    """Raised when ProofLint cannot locate a pandoc executable."""


def _append_candidate(candidates: list[Path], seen: set[str], raw_path: str | Path | None) -> None:
    if not raw_path:
        return

    candidate = Path(raw_path).expanduser()
    key = str(candidate)
    if key in seen:
        return

    seen.add(key)
    candidates.append(candidate)


def _candidate_paths() -> list[Path]:
    candidates: list[Path] = []
    seen: set[str] = set()

    _append_candidate(candidates, seen, os.environ.get("PROOFLINT_PANDOC_PATH", "").strip())

    discovered = shutil.which("pandoc")
    _append_candidate(candidates, seen, discovered)

    prefixes = [
        Path(sys.executable).resolve().parent.parent,
        Path(sys.prefix).resolve(),
    ]

    conda_prefix = os.environ.get("CONDA_PREFIX", "").strip()
    if conda_prefix:
        prefixes.append(Path(conda_prefix).expanduser())

    for prefix in prefixes:
        for candidate in (
            prefix / "bin" / "pandoc",
            prefix / "bin" / "pandoc.exe",
            prefix / "Scripts" / "pandoc.exe",
            prefix / "Scripts" / "pandoc.cmd",
            prefix / "Library" / "bin" / "pandoc.exe",
            prefix / "Library" / "bin" / "pandoc",
        ):
            _append_candidate(candidates, seen, candidate)

    return candidates


@lru_cache(maxsize=1)
def resolve_pandoc_path() -> str:
    """Return the pandoc executable path, or raise an actionable error."""
    for candidate in _candidate_paths():
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)

    raise PandocResolutionError(
        "Pandoc is not available for document ingestion. "
        "Start ProofLint with `python3 prooflint.py` so the managed conda environment is used, "
        "or install pandoc and make sure it is on PATH."
    )
