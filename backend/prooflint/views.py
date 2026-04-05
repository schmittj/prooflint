"""Settings & system API — read/write .env, health check, shutdown.

Restricted to localhost connections only.  API keys are masked on read
so they never travel in full over the wire (the user submits new values
but never sees old ones in plain text).
"""

import json
import os
import re
import signal
from pathlib import Path

from django.conf import settings
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

ENV_FILE = Path(settings.BASE_DIR).parent / ".env"

# Keys the user may read/write through the Settings page.
ALLOWED_KEYS = {
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "DEFAULT_MODEL",
    "DEFAULT_TEMPERATURE",
}

# Keys whose values are masked on read.
SECRET_KEYS = {"ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"}


def _is_localhost(request):
    remote = request.META.get("REMOTE_ADDR", "")
    return remote in ("127.0.0.1", "::1")


def _mask(value):
    """Show first 4 and last 4 characters, mask the rest."""
    if len(value) <= 12:
        return "*" * len(value)
    return value[:4] + "*" * (len(value) - 8) + value[-4:]


def _read_env():
    """Parse .env into an ordered list of (raw_line, key, value) tuples.

    Comments and blank lines have key=None.
    """
    lines = []
    if ENV_FILE.exists():
        for raw in ENV_FILE.read_text().splitlines():
            stripped = raw.strip()
            if stripped and not stripped.startswith("#") and "=" in stripped:
                key, _, value = stripped.partition("=")
                lines.append((raw, key.strip(), value.strip()))
            else:
                lines.append((raw, None, None))
    return lines


def _write_env(parsed_lines):
    """Write parsed lines back to .env."""
    ENV_FILE.write_text(
        "\n".join(raw for raw, _, _ in parsed_lines) + "\n"
    )


class SettingsView(APIView):
    """GET  /api/v1/settings/  — current (masked) settings
    POST /api/v1/settings/  — update settings
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        if not _is_localhost(request):
            return Response(
                {"error": "Settings are only accessible from localhost."},
                status=status.HTTP_403_FORBIDDEN,
            )

        result = {}
        for _, key, value in _read_env():
            if key and key in ALLOWED_KEYS and value is not None:
                if key in SECRET_KEYS and value:
                    result[key] = _mask(value)
                else:
                    result[key] = value

        # Include keys that exist in ALLOWED_KEYS but aren't in .env yet
        for key in ALLOWED_KEYS:
            if key not in result:
                result[key] = ""

        return Response({
            "settings": result,
            "notice": (
                "All data stays on your local machine. "
                "ProofLint never sends configuration to external servers."
            ),
        })

    def post(self, request):
        if not _is_localhost(request):
            return Response(
                {"error": "Settings are only accessible from localhost."},
                status=status.HTTP_403_FORBIDDEN,
            )

        data = request.data
        if not isinstance(data, dict):
            return Response(
                {"error": "Expected a JSON object."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        updates = {k: str(v) for k, v in data.items() if k in ALLOWED_KEYS}

        # Never write back masked values — drop keys whose value looks masked
        updates = {
            k: v for k, v in updates.items()
            if not (k in SECRET_KEYS and "*" in v)
        }

        if not updates:
            return Response(
                {"error": "No recognised settings provided.",
                 "allowed": sorted(ALLOWED_KEYS)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate
        if "DEFAULT_TEMPERATURE" in updates:
            try:
                temp = float(updates["DEFAULT_TEMPERATURE"])
                if not (0.0 <= temp <= 2.0):
                    raise ValueError
            except (ValueError, TypeError):
                return Response(
                    {"error": "DEFAULT_TEMPERATURE must be a number between 0 and 2."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Read current file, update in place
        parsed = _read_env()
        seen = set()
        new_parsed = []
        for raw, key, value in parsed:
            if key and key in updates:
                new_parsed.append(
                    ("{}={}".format(key, updates[key]), key, updates[key])
                )
                seen.add(key)
            else:
                new_parsed.append((raw, key, value))

        # Append any keys not already in the file
        for key in sorted(updates):
            if key not in seen:
                new_parsed.append(
                    ("{}={}".format(key, updates[key]), key, updates[key])
                )

        # Create .env if it doesn't exist
        if not parsed and not ENV_FILE.exists():
            header = (
                "# ProofLint configuration\n"
                "# Managed via Settings page — you can also edit this file directly.\n"
                "\n"
            )
            new_parsed = [
                (line, None, None) for line in header.splitlines()
            ] + new_parsed

        _write_env(new_parsed)

        return Response({
            "status": "ok",
            "updated": sorted(updates.keys()),
            "notice": "Settings saved. Restart ProofLint for changes to take effect.",
        })


class HealthView(APIView):
    """GET /api/v1/health/ — simple liveness check."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        return Response({"status": "ok"})


class ShutdownView(APIView):
    """POST /api/v1/shutdown/ — gracefully stop the ProofLint server.

    Only works from localhost.  Sends SIGTERM to the parent process
    (the launcher), which then tears down both backend and frontend.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        if not _is_localhost(request):
            return Response(
                {"error": "Shutdown is only accessible from localhost."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Send SIGTERM to the parent (the launcher script)
        ppid = os.getppid()
        try:
            os.kill(ppid, signal.SIGTERM)
        except OSError:
            # Fallback: terminate ourselves
            os.kill(os.getpid(), signal.SIGTERM)

        return Response({"status": "shutting down"})
