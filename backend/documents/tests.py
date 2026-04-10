from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from documents.ingestion.macro_expander import expand_macros
from documents.ingestion.ast_processor import (
    _normalize_display_math_text,
    process_ast,
)
from documents.ingestion.pandoc import PandocResolutionError, resolve_pandoc_path
from documents.ingestion.preamble import extract_macros


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


def test_extract_macros_handles_nested_braces():
    preamble = r"""
    \newcommand{\bb}[1]{{\mathbb{#1}}}
    \newcommand{\cl}[1]{{\mathscr{#1}}}
    \newcommand{\ca}[1]{{\mathcal{#1}}}
    \def\defeq{\stackrel{\text{\tiny def}}{=}}
    """

    macros = extract_macros(preamble)

    assert macros["\\bb"] == {"expansion": "{\\mathbb{#1}}", "arity": 1}
    assert macros["\\cl"] == {"expansion": "{\\mathscr{#1}}", "arity": 1}
    assert macros["\\ca"] == {"expansion": "{\\mathcal{#1}}", "arity": 1}
    assert macros["\\defeq"] == {
        "expansion": "\\stackrel{\\text{\\tiny def}}{=}",
        "arity": 0,
    }


def test_process_ast_preserves_latex_labels_refs_citations_and_macros():
    try:
        resolve_pandoc_path()
    except PandocResolutionError as exc:
        pytest.skip(str(exc))

    source = r"""
    \begin{theorem}\label{LiftingSections}
    Let $\cl{A}$ be an object.
    \end{theorem}

    See theorem \ref{LiftingSections} and
    \cite[\href{http://stacks.math.columbia.edu/tag/025X}{Tag 025X}]{stacks-project}.
    """
    macros = {"\\cl": {"expansion": "{\\mathscr{#1}}", "arity": 1}}
    expanded_source, _ = expand_macros(source, macros)

    blocks = process_ast(
        source=source,
        source_format="latex",
        expanded_source=expanded_source,
        theorem_env_table={"theorem": {"display_name": "Theorem"}},
    )

    theorem = next(b for b in blocks if b["block_type"] == "theorem")
    paragraph = next(
        b
        for b in blocks
        if b["block_type"] == "paragraph" and b["block_id"] != "thm1.p1"
    )

    assert theorem["label"] == "LiftingSections"
    assert "{\\mathscr{A}}" in theorem["content_original"]
    assert "[1](#LiftingSections)" in paragraph["content_original"]
    assert "stacks-project" in paragraph["content_original"]
    assert "[Tag 025X](http://stacks.math.columbia.edu/tag/025X)" in paragraph[
        "content_original"
    ]


def test_process_ast_keeps_xymatrix_as_raw_latex_fallback():
    try:
        resolve_pandoc_path()
    except PandocResolutionError as exc:
        pytest.skip(str(exc))

    source = r"""
    \begin{displaymath}
    \xymatrix{A \ar[r] & B}
    \end{displaymath}
    """

    blocks = process_ast(
        source=source,
        source_format="latex",
        expanded_source=source,
        theorem_env_table={},
    )

    assert blocks[0]["block_type"] == "raw_latex"
    assert "\\xymatrix" in blocks[0]["content_original"]


def test_process_ast_normalizes_equation_environments_to_display_math():
    try:
        resolve_pandoc_path()
    except PandocResolutionError as exc:
        pytest.skip(str(exc))

    source = r"""
    \begin{equation}
    \begin{split}
    \alpha\colon C_0 & \rightarrow J_0 \\
    q & \mapsto [q-e_K] \\
    \end{split}
    \end{equation}

    \begin{equation*}
    \zeta\colon \operatorname{Pic}^0_{\mathscr{C}/\mathscr{S}} \rightarrow \mathscr{A}
    \end{equation*}
    """

    blocks = process_ast(
        source=source,
        source_format="latex",
        expanded_source=source,
        theorem_env_table={},
    )

    equations = [b for b in blocks if b["block_type"] == "equation"]
    assert len(equations) == 2
    assert equations[0]["content_original"].startswith("$$\\begin{split}")
    assert "\\end{equation}" not in equations[0]["content_original"]
    assert equations[1]["content_original"].startswith("$$\\zeta")
    assert "\\end{equation" not in equations[1]["content_original"]


def test_normalize_display_math_text_strips_outer_equation_envs():
    assert _normalize_display_math_text(
        r"""
        \begin{equation}
        \begin{split}
        a &= b
        \end{split}
        \end{equation}
        """
    ) == "\\begin{split}\n        a &= b\n        \\end{split}"
    assert _normalize_display_math_text(
        r"""
        \begin{equation*}
        \zeta\colon X \rightarrow Y
        \end{equation*}
        """
    ) == "\\zeta\\colon X \\rightarrow Y"


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
