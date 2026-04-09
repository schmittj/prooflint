from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from documents.ingestion.ast_processor import process_ast
from documents.ingestion.pandoc import PandocResolutionError, resolve_pandoc_path


@pytest.fixture(autouse=True)
def clear_pandoc_cache():
    resolve_pandoc_path.cache_clear()
    yield
    resolve_pandoc_path.cache_clear()


def test_resolve_pandoc_path_prefers_explicit_env_var(tmp_path, monkeypatch):
    pandoc = tmp_path / "pandoc"
    pandoc.write_text("#!/bin/sh\n")
    pandoc.chmod(0o755)

    monkeypatch.setenv("PROOFLINT_PANDOC_PATH", str(pandoc))
    monkeypatch.setattr("documents.ingestion.pandoc.shutil.which", lambda _: None)

    assert resolve_pandoc_path() == str(pandoc)


def test_resolve_pandoc_path_falls_back_to_python_env(tmp_path, monkeypatch):
    env_root = tmp_path / "env"
    bin_dir = env_root / "bin"
    bin_dir.mkdir(parents=True)
    pandoc = bin_dir / "pandoc"
    pandoc.write_text("#!/bin/sh\n")
    pandoc.chmod(0o755)

    monkeypatch.delenv("PROOFLINT_PANDOC_PATH", raising=False)
    monkeypatch.delenv("CONDA_PREFIX", raising=False)
    monkeypatch.setattr("documents.ingestion.pandoc.shutil.which", lambda _: None)
    monkeypatch.setattr("documents.ingestion.pandoc.sys.executable", str(bin_dir / "python"))
    monkeypatch.setattr("documents.ingestion.pandoc.sys.prefix", str(env_root))

    assert resolve_pandoc_path() == str(pandoc)


def test_process_ast_passes_resolved_pandoc_path():
    with (
        patch("documents.ingestion.ast_processor.resolve_pandoc_path", return_value="/tmp/pandoc"),
        patch("documents.ingestion.ast_processor.pf.convert_text", return_value=[]) as mocked_convert,
    ):
        process_ast(
            source="Hello $1+2=4$",
            source_format="markdown",
            expanded_source="Hello $1+2=4$",
        )

    assert mocked_convert.call_args.kwargs["pandoc_path"] == "/tmp/pandoc"


def test_document_create_returns_actionable_pandoc_error(client, db):
    with patch(
        "documents.views.ingest_document",
        side_effect=PandocResolutionError(
            "Pandoc is not available for document ingestion."
        ),
    ):
        response = client.post(
            "/api/v1/documents/",
            data=json.dumps(
                {
                    "source": "Hello $1+2=4$",
                    "source_format": "markdown",
                    "title": "",
                    "preset": "manual",
                }
            ),
            content_type="application/json",
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Pandoc is not available for document ingestion."
