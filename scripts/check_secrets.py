#!/usr/bin/env python3
"""Block pushes that contain likely secrets or local-only sensitive files."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import PurePosixPath

ZERO_SHA = "0" * 40

SECRET_PATTERNS = [
    ("OpenAI-style key", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b")),
    ("Anthropic key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z\-_]{35}\b")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("GitHub personal access token", re.compile(r"\bghp_[A-Za-z0-9]{36}\b")),
    ("GitHub fine-grained token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b")),
    ("Private key block", re.compile(r"-----BEGIN [A-Z ]+PRIVATE KEY-----")),
]


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        check=check,
        text=True,
        capture_output=True,
    )


def pushed_commits(stdin_text: str, all_history: bool) -> list[str]:
    if all_history:
        result = git("rev-list", "--all")
        return [line for line in result.stdout.splitlines() if line]

    commits: list[str] = []
    seen: set[str] = set()
    lines = [line.strip() for line in stdin_text.splitlines() if line.strip()]

    if not lines:
        result = git("rev-list", "HEAD")
        return [line for line in result.stdout.splitlines() if line]

    for line in lines:
        local_ref, local_sha, remote_ref, remote_sha = line.split()
        del local_ref, remote_ref
        if local_sha == ZERO_SHA:
            continue
        rev_spec = local_sha if remote_sha == ZERO_SHA else f"{remote_sha}..{local_sha}"
        result = git("rev-list", rev_spec)
        for commit in result.stdout.splitlines():
            if commit and commit not in seen:
                commits.append(commit)
                seen.add(commit)

    return commits


def changed_paths(commit: str) -> list[str]:
    result = git(
        "diff-tree",
        "--root",
        "--no-commit-id",
        "--diff-filter=AMCRT",
        "-r",
        "--name-only",
        commit,
    )
    return [line for line in result.stdout.splitlines() if line]


def path_reason(path: str) -> str | None:
    pure = PurePosixPath(path)
    basename = pure.name
    suffix = pure.suffix.lower()
    parts = pure.parts

    if basename == ".env":
        return "committed .env file"
    if basename.startswith(".env.") and basename != ".env.example":
        return "committed environment file variant"
    if suffix in {".sqlite3", ".db"}:
        return "committed local database file"
    if suffix in {".pem", ".key", ".crt", ".p12", ".pfx"}:
        return "committed key or certificate material"
    if parts and parts[0] in {".codex", ".claude"}:
        return "committed local tool state"
    if parts and parts[0] == "notes":
        return "committed local notes"
    if len(parts) >= 2 and parts[0] == "backend" and parts[1] == "media":
        return "committed generated backend media"

    return None


def file_text(commit: str, path: str) -> str:
    result = subprocess.run(
        ["git", "show", f"{commit}:{path}"],
        check=True,
        capture_output=True,
    )
    data = result.stdout
    if b"\0" in data:
        return ""
    return data.decode("utf-8", errors="ignore")


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--all-history",
        action="store_true",
        help="Scan every reachable commit instead of only the refs being pushed.",
    )
    args = parser.parse_args()

    commits = pushed_commits(sys.stdin.read(), all_history=args.all_history)
    if not commits:
        return 0

    path_findings: list[str] = []
    secret_findings: list[str] = []

    for commit in commits:
        for path in changed_paths(commit):
            reason = path_reason(path)
            if reason:
                path_findings.append(f"{commit} {path}: {reason}")

            text = file_text(commit, path)
            if not text:
                continue

            for label, pattern in SECRET_PATTERNS:
                for match in pattern.finditer(text):
                    lineno = line_number(text, match.start())
                    line = text.splitlines()[lineno - 1].strip()
                    secret_findings.append(
                        f"{commit} {path}:{lineno}: {label}: {line[:160]}"
                    )

    if not path_findings and not secret_findings:
        return 0

    print("Push blocked: potential secrets or sensitive local files detected.", file=sys.stderr)
    if path_findings:
        print("\nSensitive paths:", file=sys.stderr)
        for finding in path_findings:
            print(f"  - {finding}", file=sys.stderr)
    if secret_findings:
        print("\nSecret-like content:", file=sys.stderr)
        for finding in secret_findings:
            print(f"  - {finding}", file=sys.stderr)
    print(
        "\nRemove the data from the commits being pushed, or rotate it first if it was real.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
