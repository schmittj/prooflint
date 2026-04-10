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
    "claim": "theorem",
    "conjecture": "theorem",
    "condition": "definition",
    "problem": "definition",
    "aside": "remark",
}

PROOF_CLASSES = {"proof"}
THEOREM_COUNTER_TYPES = {
    "theorem",
    "lemma",
    "proposition",
    "corollary",
    "definition",
    "remark",
}

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

_LOCAL_REF_LINK_RE = re.compile(r"\[([^\]]+)\]\(#([^)]+)\)")
_OUTER_DISPLAY_ENV_RE = re.compile(
    r"^\s*\\begin\{(equation\*?|displaymath)\}\s*(.*?)\s*\\end\{\1\}\s*$",
    re.DOTALL,
)


def _map_theorem_display_name(display_name: str) -> str:
    """Map a LaTeX theorem display name to ProofLint's block taxonomy."""
    text = display_name.lower()
    words = re.findall(r"[a-z]+", text)
    if any(word.startswith("lem") for word in words):
        return "lemma"
    if any(word.startswith("prop") for word in words):
        return "proposition"
    if any(word.startswith("cor") for word in words):
        return "corollary"
    if any(word.startswith("def") or word == "condition" for word in words):
        return "definition"
    if any(word in {"remark", "note", "aside", "example"} for word in words):
        return "remark"
    return "theorem"


def _resolve_label_references(blocks: list[dict]) -> None:
    """Rewrite label-ref links to show document numbers instead of labels."""
    label_numbers: dict[str, str] = {}
    theorem_counter = 0
    section_counter = 0

    for block in blocks:
        block_type = block["block_type"]
        label = block.get("label", "")
        if block_type == "section_heading":
            section_counter += 1
            if label:
                label_numbers[label] = str(section_counter)
        elif block_type in THEOREM_COUNTER_TYPES:
            theorem_counter += 1
            if label:
                label_numbers[label] = str(theorem_counter)

    def replace_refs(text: str) -> str:
        def repl(match: re.Match) -> str:
            target = match.group(2)
            if target not in label_numbers:
                return match.group(0)
            return f"[{label_numbers[target]}](#{target})"

        return _LOCAL_REF_LINK_RE.sub(repl, text)

    def update_block_text(block: dict) -> None:
        for key in ("content_original", "content_expanded"):
            block[key] = replace_refs(block[key])
        if block.get("sentences"):
            sentences = split_sentences(block["content_original"])
            for sentence in sentences:
                sentence["id"] = f"{block['block_id']}.{sentence.pop('id_suffix')}"
            block["sentences"] = sentences

    for block in blocks:
        update_block_text(block)
        for child in block.get("children", []):
            update_block_text(child)


def _normalize_display_math_text(text: str) -> str:
    """Remove redundant outer display environments from Pandoc math text."""
    text = text.strip()
    while True:
        match = _OUTER_DISPLAY_ENV_RE.match(text)
        if not match:
            return text
        text = match.group(2).strip()


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
            if envname in THEOREM_LIKE:
                continue
            display = info.get("display_name", envname)
            custom_envs[envname] = _map_theorem_display_name(display)

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
        elif isinstance(elem, pf.Code):
            parts.append(f"`{elem.text}`")
        elif isinstance(elem, pf.Cite):
            parts.append(_stringify_cite(elem))
        elif isinstance(elem, pf.Link):
            inner = "".join(stringify_with_math(c) for c in elem.content)
            if elem.url.startswith("#") and inner.startswith("[") and inner.endswith("]"):
                inner = inner[1:-1]
            parts.append(f"[{inner}]({elem.url})")
        elif isinstance(elem, pf.Span):
            # Pandoc represents body-local \label{...} as an empty span
            # with a label attribute. It should anchor the parent block, not
            # render as visible text.
            if elem.identifier or elem.attributes.get("label"):
                inner = "".join(stringify_with_math(c) for c in elem.content)
                if not inner.strip():
                    return ""
            for child in elem.content:
                parts.append(stringify_with_math(child))
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

    def _stringify_inlines(inlines) -> str:
        return "".join(stringify_with_math(c) for c in inlines).strip()

    def _stringify_cite(elem: pf.Cite) -> str:
        citations = []
        for citation in elem.citations:
            prefix = _stringify_inlines(citation.prefix)
            suffix = _stringify_inlines(citation.suffix)
            pieces = []
            if prefix:
                pieces.append(prefix)
            pieces.append(citation.id)
            if suffix:
                pieces.append(suffix)
            citations.append(", ".join(pieces))
        return "[" + "; ".join(citations) + "]"

    def _extract_div_label(elem: pf.Div) -> str:
        """Find labels Pandoc stores either on the Div or a leading Span."""
        if elem.identifier:
            return elem.identifier
        for child in elem.content:
            if not isinstance(child, (pf.Para, pf.Plain)) or not child.content:
                continue
            first = child.content[0]
            if isinstance(first, pf.Span):
                label = first.identifier or first.attributes.get("label", "")
                if label:
                    return label
            break
        return ""

    def _make_para_block(text: str, parent_id: str = "") -> dict:
        """Create a paragraph block dict from text."""
        text = text.strip()
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
        if isinstance(elem, pf.Math):
            math_text = _normalize_display_math_text(elem.text)
        elif isinstance(elem, pf.Para) and len(elem.content) == 1 and isinstance(elem.content[0], pf.Math):
            math_text = _normalize_display_math_text(elem.content[0].text)
        else:
            math_text = _normalize_display_math_text(stringify_with_math(elem))

        if "\\xymatrix" in math_text:
            block_id = next_id("raw_latex")
            return {
                "block_id": block_id,
                "block_type": "raw_latex",
                "content_original": f"```latex\n{math_text}\n```",
                "content_expanded": f"```latex\n{math_text}\n```",
                "sentences": [],
                "label": "",
            }

        text = f"$${math_text}$$"
        block_id = next_id("equation")

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
            sentences = split_sentences(text)
            for s in sentences:
                s["id"] = f"{block_id}.{s.pop('id_suffix')}"
            return [{
                "block_id": block_id,
                "block_type": "paragraph",
                "content_original": text,
                "content_expanded": text,
                "sentences": sentences,
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
                label = _extract_div_label(elem)

                # Collect all content of the environment
                child_blocks = []
                for child in elem.content:
                    child_blocks.extend(_process_any_element(
                        child, parent_id=block_id
                    ))
                container_text = "\n\n".join(
                    child["content_original"]
                    for child in child_blocks
                    if child["content_original"].strip()
                )

                # Create the environment block. Children carry granular
                # annotation targets; the parent also stores a flattened
                # summary for previews, references, and bot context.
                blocks.append(
                    {
                        "block_id": block_id,
                        "block_type": env_type,
                        "content_original": container_text,
                        "content_expanded": container_text,
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
                container_text = "\n\n".join(
                    child["content_original"]
                    for child in child_blocks
                    if child["content_original"].strip()
                )

                blocks.append(
                    {
                        "block_id": block_id,
                        "block_type": env_type,
                        "content_original": container_text,
                        "content_expanded": container_text,
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

    _resolve_label_references(blocks)

    return blocks
