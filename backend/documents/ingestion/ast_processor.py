"""Process Pandoc AST into ProofLint blocks with stable IDs."""

import json
import re

import panflute as pf

from .pandoc import resolve_pandoc_path
from .sentence_splitter import split_sentences


_LATEX_ENV_RE = re.compile(
    r"\\begin\{(\w+)\}"       # \begin{envname}
    r"(?:\[([^\]]*)\])?"      # optional [label/title]
    r"(?:\\label\{([^}]*)\})?"  # optional \label{...}
    r"(.*?)"                   # body
    r"\\end\{\1\}",           # \end{envname}
    re.DOTALL,
)


def _detect_latex_env(
    text: str, known_envs: dict
) -> tuple[str, str, str] | None:
    """Detect a LaTeX theorem/proof environment in raw text.

    Returns (env_type, label, body) if found, None otherwise.
    """
    text = text.strip()
    m = _LATEX_ENV_RE.match(text)
    if not m:
        return None
    envname = m.group(1)
    if envname in known_envs:
        env_type = known_envs[envname]
    elif envname == "proof":
        env_type = "proof"
    else:
        return None
    label = m.group(3) or ""
    body = m.group(4).strip()
    return env_type, label, body

# Environment classes that pandoc maps from LaTeX \begin{...} environments
THEOREM_LIKE = {
    "theorem": "theorem",
    "lemma": "lemma",
    "proposition": "proposition",
    "corollary": "corollary",
    "definition": "definition",
    "remark": "remark",
    "example": "remark",
}

PROOF_CLASSES = {"proof"}

# Short prefixes for block IDs
TYPE_PREFIX = {
    "theorem": "thm",
    "lemma": "lem",
    "proposition": "prop",
    "corollary": "cor",
    "definition": "def",
    "remark": "rem",
    "proof": "pf",
    "equation": "eq",
    "figure": "fig",
    "section_heading": "sec",
    "paragraph": "p",
    "list": "list",
    "raw_latex": "raw",
    "blockquote": "bq",
}


def process_ast(
    source: str,
    source_format: str,
    expanded_source: str,
    theorem_env_table: dict | None = None,
) -> list[dict]:
    """Parse source through pandoc and extract blocks.

    Args:
        source: Original source text.
        source_format: "markdown" or "latex".
        expanded_source: Source with macros expanded (what we actually parse).
        theorem_env_table: Custom \newtheorem declarations {envname: {"display_name": ...}}.

    Returns:
        List of block dicts ready for Block model creation.
    """
    fmt = "markdown+tex_math_single_backslash" if source_format == "markdown" else "latex"
    pandoc_path = resolve_pandoc_path()
    elements = pf.convert_text(
        expanded_source,
        input_format=fmt,
        output_format="panflute",
        pandoc_path=pandoc_path,
    )

    # Extend theorem-like detection with custom declarations
    custom_envs = {}
    if theorem_env_table:
        for envname, info in theorem_env_table.items():
            display = info.get("display_name", envname).lower()
            # Map to the closest standard type, or default to "theorem"
            if any(kw in display for kw in ("lemma", "lem")):
                custom_envs[envname] = "lemma"
            elif any(kw in display for kw in ("prop",)):
                custom_envs[envname] = "proposition"
            elif any(kw in display for kw in ("cor",)):
                custom_envs[envname] = "corollary"
            elif any(kw in display for kw in ("def",)):
                custom_envs[envname] = "definition"
            elif any(kw in display for kw in ("rem", "remark", "note")):
                custom_envs[envname] = "remark"
            else:
                custom_envs[envname] = "theorem"

    all_theorem_envs = {**THEOREM_LIKE, **custom_envs}

    # Counters for ID assignment
    counters: dict[str, int] = {}
    blocks: list[dict] = []

    def next_id(block_type: str) -> str:
        prefix = TYPE_PREFIX.get(block_type, block_type[:3])
        counters[prefix] = counters.get(prefix, 0) + 1
        return f"{prefix}{counters[prefix]}"

    def stringify_with_math(elem) -> str:
        """Stringify preserving LaTeX math."""
        parts = []
        if isinstance(elem, pf.Str):
            parts.append(elem.text)
        elif isinstance(elem, pf.Space):
            parts.append(" ")
        elif isinstance(elem, pf.SoftBreak):
            parts.append(" ")
        elif isinstance(elem, pf.LineBreak):
            parts.append("\n")
        elif isinstance(elem, pf.Math):
            if elem.format == "InlineMath":
                parts.append(f"${elem.text}$")
            else:
                parts.append(f"$${elem.text}$$")
        elif isinstance(elem, pf.RawInline):
            parts.append(elem.text)
        elif isinstance(elem, pf.Strong):
            inner = "".join(stringify_with_math(c) for c in elem.content)
            parts.append(f"**{inner}**")
        elif isinstance(elem, pf.Emph):
            inner = "".join(stringify_with_math(c) for c in elem.content)
            parts.append(f"*{inner}*")
        elif hasattr(elem, "content"):
            for child in elem.content:
                parts.append(stringify_with_math(child))
        elif isinstance(elem, pf.Quoted):
            inner = "".join(stringify_with_math(c) for c in elem.content)
            if elem.quote_type == "SingleQuote":
                parts.append(f"'{inner}'")
            else:
                parts.append(f'"{inner}"')
        return "".join(parts)

    def _make_para_block(text: str, parent_id: str = "") -> dict:
        """Create a paragraph block dict from text."""
        block_id = next_id("paragraph")
        if parent_id:
            block_id = f"{parent_id}.{block_id}"
        sentences = split_sentences(text)
        for s in sentences:
            s["id"] = f"{block_id}.{s.pop('id_suffix')}"
        return {
            "block_id": block_id,
            "block_type": "paragraph",
            "content_original": text,
            "content_expanded": text,
            "sentences": sentences,
            "label": "",
        }

    def process_para(elem, parent_id: str = "") -> list[dict]:
        """Process a paragraph, splitting at display-math boundaries.

        When a Para contains interleaved text and DisplayMath (common when
        \\[...\\] appears without surrounding blank lines), we split into
        separate paragraph and equation blocks so remark-math can render
        display math correctly.
        """
        has_display_math = any(
            isinstance(c, pf.Math) and c.format == "DisplayMath"
            for c in elem.content
        )
        if not has_display_math:
            return [_make_para_block(stringify_with_math(elem), parent_id)]

        results: list[dict] = []
        current_inlines: list = []

        def flush_text():
            nonlocal current_inlines
            text = "".join(stringify_with_math(c) for c in current_inlines).strip()
            current_inlines = []
            if text:
                results.append(_make_para_block(text, parent_id))

        for child in elem.content:
            if isinstance(child, pf.Math) and child.format == "DisplayMath":
                flush_text()
                results.append(process_math_block(child))
            else:
                current_inlines.append(child)

        flush_text()
        return results

    def process_math_block(elem) -> dict:
        """Process a display math block."""
        block_id = next_id("equation")
        if isinstance(elem, pf.Math):
            text = f"$${elem.text}$$"
        elif isinstance(elem, pf.Para) and len(elem.content) == 1 and isinstance(elem.content[0], pf.Math):
            text = f"$${elem.content[0].text}$$"
        else:
            text = stringify_with_math(elem)

        return {
            "block_id": block_id,
            "block_type": "equation",
            "content_original": text,
            "content_expanded": text,
            "sentences": [],
            "label": "",
        }

    def is_display_math_para(elem) -> bool:
        """Check if a Para contains only a single display math element."""
        if isinstance(elem, pf.Para) and len(elem.content) == 1:
            child = elem.content[0]
            return isinstance(child, pf.Math) and child.format == "DisplayMath"
        return False

    def block_to_markdown(elem) -> str:
        """Serialize a block-level element to markdown via pandoc."""
        doc = pf.Doc(elem)
        return pf.convert_text(
            json.dumps(doc.to_json()),
            input_format="json",
            output_format="markdown",
            extra_args=["--wrap=none"],
            pandoc_path=pandoc_path,
        ).strip()

    def process_list(elem, parent_id: str = "") -> dict:
        """Process a list element into a block dict."""
        block_id = next_id("list")
        if parent_id:
            block_id = f"{parent_id}.{block_id}"
        text = block_to_markdown(elem)
        return {
            "block_id": block_id,
            "block_type": "list",
            "content_original": text,
            "content_expanded": text,
            "sentences": [],
            "label": "",
        }

    def _process_blockquote(elem, parent_id: str = "") -> dict:
        """Process a blockquote element as a leaf block with content.

        Uses pandoc round-trip on the blockquote's children to preserve
        multi-paragraph and list structure without the > prefixes.
        """
        block_id = next_id("blockquote")
        if parent_id:
            block_id = f"{parent_id}.{block_id}"
        doc = pf.Doc(*list(elem.content))
        text = pf.convert_text(
            json.dumps(doc.to_json()),
            input_format="json",
            output_format="markdown",
            extra_args=["--wrap=none"],
            pandoc_path=pandoc_path,
        ).strip()
        sentences = split_sentences(text)
        for s in sentences:
            s["id"] = f"{block_id}.{s.pop('id_suffix')}"
        return {
            "block_id": block_id,
            "block_type": "blockquote",
            "content_original": text,
            "content_expanded": text,
            "sentences": sentences,
            "label": "",
        }

    def _process_any_element(elem, parent_id: str = "") -> list[dict]:
        """Process any block-level element into block dicts."""
        if isinstance(elem, pf.Para):
            if is_display_math_para(elem):
                return [process_math_block(elem)]
            return process_para(elem, parent_id=parent_id)
        elif isinstance(elem, (pf.BulletList, pf.OrderedList)):
            return [process_list(elem, parent_id=parent_id)]
        elif isinstance(elem, pf.RawBlock):
            block_id = next_id("raw_latex")
            if parent_id:
                block_id = f"{parent_id}.{block_id}"
            return [{
                "block_id": block_id,
                "block_type": "raw_latex",
                "content_original": elem.text,
                "content_expanded": elem.text,
                "sentences": [],
                "label": "",
            }]
        elif isinstance(elem, pf.BlockQuote):
            return [_process_blockquote(elem, parent_id=parent_id)]
        elif isinstance(elem, pf.Div):
            # Nested div — stringify it
            block_id = next_id("paragraph")
            if parent_id:
                block_id = f"{parent_id}.{block_id}"
            text = stringify_with_math(elem)
            return [{
                "block_id": block_id,
                "block_type": "paragraph",
                "content_original": text,
                "content_expanded": text,
                "sentences": split_sentences(text),
                "label": "",
            }]
        return []

    for elem in elements:
        if isinstance(elem, pf.Header):
            block_id = next_id("section_heading")
            text = stringify_with_math(elem)
            blocks.append(
                {
                    "block_id": block_id,
                    "block_type": "section_heading",
                    "content_original": text,
                    "content_expanded": text,
                    "sentences": [],
                    "label": elem.identifier or "",
                }
            )

        elif isinstance(elem, pf.Div):
            # Check for theorem-like or proof environments
            env_type = None
            for cls in elem.classes:
                if cls in all_theorem_envs:
                    env_type = all_theorem_envs[cls]
                    break
                if cls in PROOF_CLASSES:
                    env_type = "proof"
                    break

            if env_type:
                block_id = next_id(env_type)
                label = elem.identifier or ""

                # Collect all content of the environment
                child_blocks = []
                for child in elem.content:
                    child_blocks.extend(_process_any_element(
                        child, parent_id=block_id
                    ))

                # Create the environment block (content is in children only)
                blocks.append(
                    {
                        "block_id": block_id,
                        "block_type": env_type,
                        "content_original": "",  # children carry the content
                        "content_expanded": "",
                        "sentences": [],
                        "label": label,
                        "children": child_blocks,
                    }
                )
            else:
                # Unknown div — process children as top-level
                for child in elem.content:
                    blocks.extend(_process_any_element(child))

        elif isinstance(elem, pf.Para):
            if is_display_math_para(elem):
                blocks.append(process_math_block(elem))
            else:
                blocks.extend(process_para(elem))

        elif isinstance(elem, pf.RawBlock):
            # Check if this is a LaTeX environment that pandoc couldn't parse
            # (happens when \begin{theorem} etc. appear in markdown input)
            env_match = _detect_latex_env(elem.text, all_theorem_envs)
            if env_match:
                env_type, label, body = env_match
                block_id = next_id(env_type)
                # Re-parse the body through pandoc to get structured content
                body_elements = pf.convert_text(
                    body,
                    input_format="latex",
                    output_format="panflute",
                    pandoc_path=pandoc_path,
                )
                child_blocks = []
                for child_elem in body_elements:
                    child_blocks.extend(_process_any_element(
                        child_elem, parent_id=block_id
                    ))

                blocks.append(
                    {
                        "block_id": block_id,
                        "block_type": env_type,
                        "content_original": "",
                        "content_expanded": "",
                        "sentences": [],
                        "label": label,
                        "children": child_blocks,
                    }
                )
            else:
                block_id = next_id("raw_latex")
                blocks.append(
                    {
                        "block_id": block_id,
                        "block_type": "raw_latex",
                        "content_original": elem.text,
                        "content_expanded": elem.text,
                        "sentences": [],
                        "label": "",
                    }
                )

        elif isinstance(elem, pf.BlockQuote):
            blocks.append(_process_blockquote(elem))

        elif isinstance(elem, (pf.BulletList, pf.OrderedList)):
            blocks.append(process_list(elem))

    # Assign order
    order = 0
    for block in blocks:
        block["order"] = order
        order += 1
        # Children get sequential orders too
        if "children" in block:
            for child in block["children"]:
                child["order"] = order
                order += 1

    return blocks
