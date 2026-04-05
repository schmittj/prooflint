#!/usr/bin/env python3
"""ProofLint — AI-assisted proof review workbench.

One-command setup and launcher.  Requires only Python >= 3.8 (stdlib).
All other dependencies (Python 3.11, Node.js, Pandoc) are managed
automatically via a Miniforge/conda environment.

Usage:
    python3 prooflint.py              # install if needed, then start
    python3 prooflint.py --dev        # developer mode (verbose logs, no browser)
    python3 prooflint.py --install    # install only, don't start servers
    python3 prooflint.py --reset      # recreate the conda environment
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import webbrowser
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CONDA_ENV = "prooflint"
CONDA_PYTHON = "3.11"
CONDA_PACKAGES = ["nodejs=20", "pandoc"]

PROJECT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = PROJECT_DIR / "backend"
FRONTEND_DIR = PROJECT_DIR / "frontend"
ENV_FILE = PROJECT_DIR / ".env"
ENV_EXAMPLE = PROJECT_DIR / ".env.example"

MINIFORGE_URLS = {
    ("Linux", "x86_64"): "https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh",
    ("Linux", "aarch64"): "https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-aarch64.sh",
    ("Darwin", "x86_64"): "https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-MacOSX-x86_64.sh",
    ("Darwin", "arm64"): "https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-MacOSX-arm64.sh",
    ("Windows", "AMD64"): "https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Windows-x86_64.exe",
}

# ---------------------------------------------------------------------------
# Terminal output helpers
# ---------------------------------------------------------------------------

def _supports_color():
    if os.environ.get("NO_COLOR"):
        return False
    if platform.system() == "Windows":
        # Windows Terminal and VS Code support ANSI
        return bool(os.environ.get("WT_SESSION") or os.environ.get("TERM_PROGRAM"))
    return hasattr(sys.stdout, "isatty") and sys.stdout.isatty()


_COLOR = _supports_color()


def _c(code, text):
    if _COLOR:
        return "\033[{}m{}\033[0m".format(code, text)
    return str(text)


def step(msg):
    print(_c("1;34", "=> ") + msg)


def success(msg):
    print(_c("1;32", "   OK: ") + msg)


def warn(msg):
    print(_c("1;33", "   !! ") + msg)


def error(msg):
    print(_c("1;31", "   !! ") + msg, file=sys.stderr)


def info(msg):
    print("      " + msg)


def banner():
    print()
    print(_c("1;36", "   ProofLint — AI-Assisted Proof Review Workbench"))
    print(_c("0;36", "   ──────────────────────────────────────────────"))
    print()


# ---------------------------------------------------------------------------
# Platform helpers
# ---------------------------------------------------------------------------

def _is_windows():
    return platform.system() == "Windows"


def _platform_key():
    system = platform.system()
    machine = platform.machine()
    if machine in ("x86_64", "AMD64"):
        machine = "AMD64" if system == "Windows" else "x86_64"
    return (system, machine)


# ---------------------------------------------------------------------------
# Conda detection and environment helpers
# ---------------------------------------------------------------------------

_prefix_cache = None  # type: Path | None


def find_conda():
    """Return the path to a conda (or mamba) executable, or None."""
    for name in ("mamba", "conda"):
        found = shutil.which(name)
        if found:
            return found

    home = Path.home()
    candidates = [
        home / "miniforge3",
        home / "mambaforge",
        home / "miniconda3",
        home / "anaconda3",
    ]
    if _is_windows():
        local = os.environ.get("LOCALAPPDATA", "")
        if local:
            candidates += [Path(local) / "miniforge3", Path(local) / "miniconda3"]

    for base in candidates:
        if _is_windows():
            for sub in ("condabin", "Scripts"):
                for ext in (".exe", ".bat"):
                    for name in ("mamba", "conda"):
                        p = base / sub / (name + ext)
                        if p.exists():
                            return str(p)
        else:
            for sub in ("condabin", "bin"):
                for name in ("mamba", "conda"):
                    p = base / sub / name
                    if p.exists():
                        return str(p)
    return None


def _env_list(conda):
    """Return the list of conda environment paths."""
    try:
        r = subprocess.run(
            [conda, "env", "list", "--json"],
            capture_output=True, text=True, timeout=30,
        )
        return json.loads(r.stdout).get("envs", [])
    except Exception:
        return []


def env_exists(conda):
    """Does the prooflint conda environment exist?"""
    sep = "\\" if _is_windows() else "/"
    return any(e.endswith(sep + CONDA_ENV) for e in _env_list(conda))


def env_prefix(conda):
    """Return the Path to the conda environment prefix (cached)."""
    global _prefix_cache
    if _prefix_cache is not None:
        return _prefix_cache
    sep = "\\" if _is_windows() else "/"
    for e in _env_list(conda):
        if e.endswith(sep + CONDA_ENV):
            _prefix_cache = Path(e)
            return _prefix_cache
    return None


def env_bin(conda, name):
    """Return the full path to an executable inside the conda env."""
    prefix = env_prefix(conda)
    if prefix is None:
        return None

    if _is_windows():
        for sub in ("Scripts", ".", "Library\\bin"):
            for ext in (".exe", ".cmd", ".bat", ""):
                p = prefix / sub / (name + ext)
                if p.exists():
                    return str(p)
    else:
        p = prefix / "bin" / name
        if p.exists():
            return str(p)
    return None


# ---------------------------------------------------------------------------
# Miniforge installation
# ---------------------------------------------------------------------------

def _download(url, dest):
    """Download a URL with a simple progress indicator."""
    req = urllib.request.Request(url, headers={"User-Agent": "ProofLint-Setup"})
    resp = urllib.request.urlopen(req)
    total = int(resp.headers.get("Content-Length", 0))
    downloaded = 0
    chunk_size = 1 << 16  # 64 KB

    with open(dest, "wb") as f:
        while True:
            chunk = resp.read(chunk_size)
            if not chunk:
                break
            f.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = int(downloaded * 100 / total)
                print("\r      downloading … {:3d}%".format(pct), end="", flush=True)
    print("\r      downloading … done   ")


def install_miniforge():
    """Download and install Miniforge silently."""
    key = _platform_key()
    url = MINIFORGE_URLS.get(key)
    if not url:
        error("Unsupported platform: {} {}".format(*key))
        info("Install Miniforge manually: https://github.com/conda-forge/miniforge")
        sys.exit(1)

    install_dir = Path.home() / "miniforge3"

    step("Downloading Miniforge (~60 MB one-time download) …")

    suffix = ".exe" if _is_windows() else ".sh"
    fd, tmp = tempfile.mkstemp(suffix=suffix)
    os.close(fd)

    try:
        _download(url, tmp)

        step("Installing Miniforge to {} …".format(install_dir))

        if _is_windows():
            subprocess.run([tmp, "/S", "/D={}".format(install_dir)], check=True)
        else:
            os.chmod(tmp, 0o755)
            subprocess.run(
                ["bash", tmp, "-b", "-p", str(install_dir)],
                check=True, capture_output=True,
            )

        success("Miniforge installed")
    except Exception as exc:
        error("Miniforge installation failed: {}".format(exc))
        info("Install manually: https://github.com/conda-forge/miniforge")
        sys.exit(1)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Environment creation & dependency installation
# ---------------------------------------------------------------------------

def create_env(conda):
    """Create the prooflint conda environment."""
    step("Creating '{}' environment (Python {}, Node.js 20, Pandoc) …".format(
        CONDA_ENV, CONDA_PYTHON))
    info("This may take a few minutes on first run.")

    cmd = (
        [conda, "create", "-n", CONDA_ENV,
         "python={}".format(CONDA_PYTHON)]
        + CONDA_PACKAGES
        + ["-y", "-q"]
    )
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        error("Failed to create conda environment.")
        if r.stderr:
            for line in r.stderr.strip().splitlines()[-5:]:
                info(line)
        sys.exit(1)

    global _prefix_cache
    _prefix_cache = None  # clear cache so it gets re-read
    success("Conda environment ready")


def install_backend(conda):
    """pip-install the backend in editable mode."""
    step("Installing backend Python packages …")
    pip = env_bin(conda, "pip")
    if not pip:
        error("pip not found in conda environment.")
        sys.exit(1)

    r = subprocess.run(
        [pip, "install", "-e", ".[dev]"],
        capture_output=True, text=True,
        cwd=str(BACKEND_DIR),
    )
    if r.returncode != 0:
        error("Backend installation failed.")
        if r.stderr:
            for line in r.stderr.strip().splitlines()[-8:]:
                info(line)
        sys.exit(1)

    # Stamp so we can detect when pyproject.toml changes
    (BACKEND_DIR / ".install-stamp").write_text("")
    success("Backend packages installed")


def install_frontend(conda):
    """npm-install frontend dependencies."""
    step("Installing frontend packages …")
    npm = env_bin(conda, "npm")
    if not npm:
        error("npm not found in conda environment.")
        sys.exit(1)

    r = subprocess.run(
        [npm, "install"],
        capture_output=True, text=True,
        cwd=str(FRONTEND_DIR),
    )
    if r.returncode != 0:
        error("Frontend installation failed.")
        if r.stderr:
            for line in r.stderr.strip().splitlines()[-8:]:
                info(line)
        sys.exit(1)

    # Stamp so we can detect when package.json changes
    (FRONTEND_DIR / ".install-stamp").write_text("")
    success("Frontend packages installed")


def run_migrations(conda):
    """Apply Django database migrations."""
    step("Setting up database …")
    python = env_bin(conda, "python")
    if not python:
        error("python not found in conda environment.")
        sys.exit(1)

    r = subprocess.run(
        [python, "manage.py", "migrate"],
        capture_output=True, text=True,
        cwd=str(BACKEND_DIR),
    )
    if r.returncode != 0:
        error("Database migration failed.")
        if r.stderr:
            for line in r.stderr.strip().splitlines()[-8:]:
                info(line)
        sys.exit(1)

    (BACKEND_DIR / ".migrate-stamp").write_text("")
    success("Database ready")


def ensure_env_file():
    """Copy .env.example → .env if missing."""
    if ENV_FILE.exists():
        return
    if ENV_EXAMPLE.exists():
        shutil.copy2(ENV_EXAMPLE, ENV_FILE)
        info("Created .env from template")
    else:
        ENV_FILE.write_text(
            "# ProofLint configuration\n"
            "# Set your API key here, or use the Settings page in the browser.\n"
            "\n"
            "ANTHROPIC_API_KEY=\n"
            "DEBUG=true\n"
        )
        info("Created .env file")


# ---------------------------------------------------------------------------
# State checks (for skipping already-done steps)
# ---------------------------------------------------------------------------

def _backend_ready(conda):
    """Check backend is installed and pyproject.toml hasn't changed since."""
    pip = env_bin(conda, "pip")
    if not pip:
        return False
    stamp = BACKEND_DIR / ".install-stamp"
    pyproject = BACKEND_DIR / "pyproject.toml"
    if not stamp.exists():
        return False
    # Re-install if pyproject.toml is newer than the stamp
    if pyproject.exists() and pyproject.stat().st_mtime > stamp.stat().st_mtime:
        return False
    return True


def _frontend_ready():
    """Check frontend is installed and package.json hasn't changed since."""
    node_modules = FRONTEND_DIR / "node_modules"
    pkg_json = FRONTEND_DIR / "package.json"
    if not node_modules.is_dir():
        return False
    stamp = FRONTEND_DIR / ".install-stamp"
    if not stamp.exists():
        return False
    if pkg_json.exists() and pkg_json.stat().st_mtime > stamp.stat().st_mtime:
        return False
    return True


def _db_ready():
    """Check DB exists.  Always run migrations (safe to rerun) unless
    nothing has changed since the last run."""
    db = BACKEND_DIR / "db.sqlite3"
    if not db.exists() or db.stat().st_size == 0:
        return False
    # Check if any migration file is newer than our stamp
    stamp = BACKEND_DIR / ".migrate-stamp"
    if not stamp.exists():
        return False
    stamp_mtime = stamp.stat().st_mtime
    for migrations_dir in BACKEND_DIR.glob("*/migrations"):
        for mig in migrations_dir.glob("*.py"):
            if mig.stat().st_mtime > stamp_mtime:
                return False
    return True


def _has_api_key():
    if not ENV_FILE.exists():
        return False
    for line in ENV_FILE.read_text().splitlines():
        stripped = line.strip()
        if stripped.startswith("ANTHROPIC_API_KEY="):
            value = stripped.split("=", 1)[1].strip()
            return len(value) > 10
    return False


# ---------------------------------------------------------------------------
# Port helpers
# ---------------------------------------------------------------------------

def _find_free_port(start, attempts=20):
    """Find a free TCP port starting from *start*."""
    for port in range(start, start + attempts):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", port))
                return port
        except OSError:
            continue
    error("No free port found near {}".format(start))
    sys.exit(1)


def _wait_for_port(port, timeout=15):
    """Block until *port* accepts connections, or timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.5)
                s.connect(("127.0.0.1", port))
                return True
        except OSError:
            time.sleep(0.3)
    return False


# ---------------------------------------------------------------------------
# Server management
# ---------------------------------------------------------------------------

def start_servers(conda, dev_mode=False):
    """Start Django and Vite, then wait."""
    python = env_bin(conda, "python")
    node = env_bin(conda, "node")
    if not python or not node:
        error("python or node not found in conda environment.")
        sys.exit(1)

    vite_js = FRONTEND_DIR / "node_modules" / "vite" / "bin" / "vite.js"
    if not vite_js.exists():
        error("Vite not found. Try: python3 prooflint.py --reset")
        sys.exit(1)

    backend_port = _find_free_port(8000)
    frontend_port = _find_free_port(5173)

    # Build PATH so subprocesses can find conda-env binaries
    prefix = env_prefix(conda)
    env = os.environ.copy()
    if _is_windows():
        extra = ";".join([
            str(prefix), str(prefix / "Scripts"), str(prefix / "Library" / "bin"),
        ])
        env["PATH"] = extra + ";" + env.get("PATH", "")
    else:
        env["PATH"] = str(prefix / "bin") + ":" + env.get("PATH", "")

    # Tell the Vite proxy where the backend lives
    env["API_URL"] = "http://localhost:{}".format(backend_port)

    out = None if dev_mode else subprocess.DEVNULL
    err = None if dev_mode else subprocess.DEVNULL

    step("Starting backend on port {} …".format(backend_port))
    backend = subprocess.Popen(
        [python, "manage.py", "runserver", str(backend_port)],
        cwd=str(BACKEND_DIR),
        env=env, stdout=out, stderr=err,
    )

    step("Starting frontend on port {} …".format(frontend_port))
    frontend = subprocess.Popen(
        [node, str(vite_js), "--port", str(frontend_port)],
        cwd=str(FRONTEND_DIR),
        env=env, stdout=out, stderr=err,
    )

    procs = [backend, frontend]

    # --- graceful shutdown -------------------------------------------------
    def shutdown(sig=None, frame=None):
        print()
        step("Shutting down …")
        for p in procs:
            try:
                p.terminate()
            except OSError:
                pass
        for p in procs:
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
        success("Stopped.  See you next time!")
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    try:
        signal.signal(signal.SIGTERM, shutdown)
    except (OSError, ValueError):
        pass  # not available on all platforms
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, shutdown)

    # --- wait for servers to be reachable ----------------------------------
    if not _wait_for_port(backend_port, timeout=20):
        warn("Backend did not start in time.  Try --dev for details.")
    if not _wait_for_port(frontend_port, timeout=15):
        warn("Frontend did not start in time.  Try --dev for details.")

    url = "http://localhost:{}".format(frontend_port)
    if not dev_mode:
        try:
            webbrowser.open(url)
        except Exception:
            pass  # non-fatal; user can open manually

    print()
    success("ProofLint is running!")
    print()
    info("Frontend : {}".format(url))
    info("Backend  : http://localhost:{}".format(backend_port))
    info("API docs : http://localhost:{}/api/v1/".format(backend_port))
    print()
    if not _has_api_key():
        warn("No API key configured — open Settings in the browser to add one.")
        print()
    info("Press Ctrl+C to stop.")
    print()

    # --- keep-alive loop ---------------------------------------------------
    try:
        while True:
            for p in procs:
                ret = p.poll()
                if ret is not None:
                    name = "Backend" if p is backend else "Frontend"
                    warn("{} exited (code {}).  Use --dev for details.".format(name, ret))
                    shutdown()
            time.sleep(1)
    except KeyboardInterrupt:
        shutdown()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    banner()

    parser = argparse.ArgumentParser(
        description="ProofLint — one-command setup & launcher",
    )
    parser.add_argument(
        "--dev", action="store_true",
        help="Developer mode: verbose server logs, no auto-open browser",
    )
    parser.add_argument(
        "--install", action="store_true",
        help="Install/update dependencies only; don't start servers",
    )
    parser.add_argument(
        "--reset", action="store_true",
        help="Remove the conda environment and reinstall from scratch",
    )
    args = parser.parse_args()

    # ------------------------------------------------------------------
    # Step 1: Conda / Miniforge
    # ------------------------------------------------------------------
    step("Checking for conda …")
    conda = find_conda()

    if not conda:
        print()
        info("ProofLint manages its own dependencies (Python, Node.js, Pandoc)")
        info("via Miniforge so you don't need to install them yourself.")
        print()
        try:
            reply = input(
                _c("1;33", "      Install Miniforge now? [Y/n] ")
            ).strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            sys.exit(0)

        if reply and reply not in ("y", "yes", ""):
            print()
            info("Install Miniforge manually:")
            info("  https://github.com/conda-forge/miniforge")
            info("Then re-run:  python3 prooflint.py")
            sys.exit(0)

        install_miniforge()
        conda = find_conda()
        if not conda:
            error("Could not find conda after installation.")
            info("Try restarting your terminal, then run again.")
            sys.exit(1)
    else:
        success("Found conda: {}".format(conda))

    # ------------------------------------------------------------------
    # Step 2: Reset (if requested)
    # ------------------------------------------------------------------
    if args.reset and env_exists(conda):
        step("Removing '{}' environment …".format(CONDA_ENV))
        subprocess.run(
            [conda, "env", "remove", "-n", CONDA_ENV, "-y"],
            capture_output=True,
        )
        global _prefix_cache
        _prefix_cache = None
        success("Environment removed")

    # ------------------------------------------------------------------
    # Step 3: Conda environment
    # ------------------------------------------------------------------
    if not env_exists(conda):
        create_env(conda)
    else:
        success("Environment '{}' ready".format(CONDA_ENV))

    # ------------------------------------------------------------------
    # Step 4: Backend dependencies
    # ------------------------------------------------------------------
    if not _backend_ready(conda):
        install_backend(conda)
    else:
        success("Backend packages up to date")

    # ------------------------------------------------------------------
    # Step 5: Frontend dependencies
    # ------------------------------------------------------------------
    if not _frontend_ready():
        install_frontend(conda)
    else:
        success("Frontend packages up to date")

    # ------------------------------------------------------------------
    # Step 6: Database
    # ------------------------------------------------------------------
    if not _db_ready():
        run_migrations(conda)
    else:
        success("Database ready")

    # ------------------------------------------------------------------
    # Step 7: .env file
    # ------------------------------------------------------------------
    ensure_env_file()

    if not _has_api_key():
        print()
        warn("No Anthropic API key configured yet.")
        info("You can add it in the browser via the Settings page,")
        info("or edit the .env file at the project root.")

    # ------------------------------------------------------------------
    # Done installing?
    # ------------------------------------------------------------------
    if args.install:
        print()
        success("Installation complete!")
        info("Run  python3 prooflint.py  to start.")
        return

    # ------------------------------------------------------------------
    # Step 8: Launch
    # ------------------------------------------------------------------
    print()
    start_servers(conda, dev_mode=args.dev)


if __name__ == "__main__":
    main()
