"""Process Pandoc AST into ProofLint blocks with stable IDs."""

import panflute as pf

from .sentence_splitter import split_sentences

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
    fmt = "markdown" if source_format == "markdown" else "latex"
    elements = pf.convert_text(expanded_source, input_format=fmt, output_format="panflute")

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

    def process_para(elem, parent_id: str = "") -> dict:
        """Process a paragraph element into a block dict."""
        text = stringify_with_math(elem)
        block_type = "paragraph"
        block_id = next_id(block_type)

        if parent_id:
            block_id = f"{parent_id}.{block_id}"
            # Reset paragraph counter within parent scope
            # (actually, we use global counters for simplicity in MVP)

        sentences = split_sentences(text)
        # Prefix sentence IDs with block ID
        for s in sentences:
            s["id"] = f"{block_id}.{s.pop('id_suffix')}"

        return {
            "block_id": block_id,
            "block_type": block_type,
            "content_original": text,
            "content_expanded": text,
            "sentences": sentences,
            "label": "",
        }

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
                full_text_parts = []
                for child in elem.content:
                    if isinstance(child, pf.Para):
                        if is_display_math_para(child):
                            child_block = process_math_block(child)
                        else:
                            child_block = process_para(child, parent_id=block_id)
                        child_blocks.append(child_block)
                        full_text_parts.append(child_block["content_original"])

                full_text = "\n\n".join(full_text_parts)

                # Create the environment block
                blocks.append(
                    {
                        "block_id": block_id,
                        "block_type": env_type,
                        "content_original": full_text,
                        "content_expanded": full_text,
                        "sentences": [],
                        "label": label,
                        "children": child_blocks,
                    }
                )
            else:
                # Unknown div — process children as top-level
                for child in elem.content:
                    if isinstance(child, pf.Para):
                        blocks.append(process_para(child))

        elif isinstance(elem, pf.Para):
            if is_display_math_para(elem):
                blocks.append(process_math_block(elem))
            else:
                blocks.append(process_para(elem))

        elif isinstance(elem, pf.RawBlock):
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

        elif isinstance(elem, (pf.BulletList, pf.OrderedList)):
            block_id = next_id("list")
            text = pf.stringify(elem)
            blocks.append(
                {
                    "block_id": block_id,
                    "block_type": "list",
                    "content_original": text,
                    "content_expanded": text,
                    "sentences": [],
                    "label": "",
                }
            )

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
