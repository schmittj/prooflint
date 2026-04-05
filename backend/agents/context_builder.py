"""
Build a ContextSlice and list of FragmentBlocks from a Document for bot input.
"""

from __future__ import annotations

from documents.models import Block, Document

from .bot_contract import BotConfig, BotInput, ContextSlice, FragmentBlock


def build_bot_input(
    document: Document,
    config: BotConfig,
    *,
    block_ids: list[str] | None = None,
) -> BotInput:
    """Construct a full BotInput for a document.

    If *block_ids* is provided, only those blocks are included as fragments
    (but the full context is still provided for reference).
    """
    fragments = _build_fragments(document, block_ids=block_ids)
    context = _build_context_slice(document)
    return BotInput(fragments=fragments, context=context, config=config)


def _build_fragments(
    document: Document,
    *,
    block_ids: list[str] | None = None,
) -> list[FragmentBlock]:
    """Convert DB Block rows into FragmentBlock dataclasses."""
    qs = Block.objects.filter(document=document).order_by("order")
    if block_ids:
        qs = qs.filter(block_id__in=block_ids)

    fragments = []
    for block in qs:
        fragments.append(
            FragmentBlock(
                block_id=block.block_id,
                block_type=block.block_type,
                content_expanded=block.content_expanded or block.content_original,
                content_original=block.content_original,
                sentences=block.sentences or [],
                label=block.label,
            )
        )
    return fragments


def _build_context_slice(document: Document) -> ContextSlice:
    """Build a ContextSlice from the document's stored structure and macro table."""
    structure = document.structure or {}

    # Notation: format macro table as human-readable entries
    notation = {}
    for macro, expansion in (document.macro_table or {}).items():
        notation[macro] = expansion

    # Theorem and definition indexes come directly from structure
    theorem_index = structure.get("theorem_index", [])
    definition_index = structure.get("definition_index", [])

    # Section path: list of section titles
    sections = structure.get("sections", [])
    section_path = [s.get("title", "") for s in sections if s.get("title")]

    total_blocks = Block.objects.filter(document=document).count()

    return ContextSlice(
        notation=notation,
        theorem_index=theorem_index,
        definition_index=definition_index,
        document_title=document.title,
        section_path=section_path,
        total_blocks=total_blocks,
        bibliography=[],  # post-MVP
    )
