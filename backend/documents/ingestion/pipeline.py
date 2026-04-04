"""Main ingestion pipeline: raw source → Document with Blocks."""

from documents.models import Block, Document

from .ast_processor import process_ast
from .macro_expander import expand_macros
from .preamble import extract_macros, extract_preamble, extract_theorem_envs


def ingest_document(document: Document) -> list[Block]:
    """Run the full ingestion pipeline on a document.

    The document must already be saved with original_source and source_format set.
    This function:
    1. Extracts preamble (LaTeX only)
    2. Extracts macros and theorem declarations
    3. Expands macros
    4. Parses through Pandoc and assigns block IDs
    5. Creates Block objects in the database

    Returns the list of created Block objects.
    """
    source = document.original_source
    source_format = document.source_format

    # Step 1–2: Preamble extraction (LaTeX only)
    if source_format == "latex":
        preamble, body = extract_preamble(source)
        macro_table = extract_macros(preamble)
        theorem_env_table = extract_theorem_envs(preamble)
    else:
        body = source
        macro_table = {}
        theorem_env_table = {}

    # Step 3: Macro expansion
    expanded_source, source_map = expand_macros(body, macro_table)

    # Update document with processed data
    document.macro_table = macro_table
    document.theorem_env_table = theorem_env_table
    document.expanded_source = expanded_source
    document.source_map = source_map

    # Step 4: Parse AST and extract blocks
    block_dicts = process_ast(
        source=body,
        source_format=source_format,
        expanded_source=expanded_source,
        theorem_env_table=theorem_env_table,
    )

    # Step 5: Create Block objects
    # First, delete any existing blocks (re-ingestion)
    document.blocks.all().delete()

    created_blocks = []
    parent_map = {}  # block_id -> Block instance

    for bd in block_dicts:
        children = bd.pop("children", [])

        block = Block.objects.create(
            document=document,
            block_id=bd["block_id"],
            block_type=bd["block_type"],
            order=bd["order"],
            content_original=bd["content_original"],
            content_expanded=bd["content_expanded"],
            sentences=bd.get("sentences", []),
            label=bd.get("label", ""),
            source_offset_start=0,  # TODO: compute from source map
            source_offset_end=0,
        )
        created_blocks.append(block)
        parent_map[bd["block_id"]] = block

        # Create child blocks (e.g. paragraphs inside a theorem/proof)
        for child in children:
            child_block = Block.objects.create(
                document=document,
                block_id=child["block_id"],
                block_type=child["block_type"],
                order=child["order"],
                parent=block,
                content_original=child["content_original"],
                content_expanded=child["content_expanded"],
                sentences=child.get("sentences", []),
                label=child.get("label", ""),
                source_offset_start=0,
                source_offset_end=0,
            )
            created_blocks.append(child_block)

    # Build structure index
    structure = _build_structure(block_dicts)
    document.structure = structure
    document.save()

    return created_blocks


def _build_structure(block_dicts: list[dict]) -> dict:
    """Build the document structure index from processed blocks."""
    sections = []
    theorem_index = []
    definition_index = []
    label_map = {}

    current_section = None

    for bd in block_dicts:
        block_id = bd["block_id"]
        block_type = bd["block_type"]
        label = bd.get("label", "")

        if label:
            label_map[label] = block_id

        if block_type == "section_heading":
            current_section = {
                "id": block_id,
                "title": bd["content_original"],
                "block_ids": [],
            }
            sections.append(current_section)
        else:
            if current_section:
                current_section["block_ids"].append(block_id)

            if block_type in ("theorem", "lemma", "proposition", "corollary"):
                theorem_index.append(
                    {
                        "id": block_id,
                        "type": block_type,
                        "label": label,
                        "statement_summary": bd["content_original"][:200],
                    }
                )
            elif block_type == "definition":
                definition_index.append(
                    {
                        "id": block_id,
                        "label": label,
                        "statement_summary": bd["content_original"][:200],
                    }
                )

    return {
        "sections": sections,
        "theorem_index": theorem_index,
        "definition_index": definition_index,
        "label_map": label_map,
    }
