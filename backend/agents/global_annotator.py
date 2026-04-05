"""
GlobalAnnotatorBot — one-pass proof reviewer.

Builds the LLM prompt, calls the OpenAI Responses API, and parses
the structured JSON output into BotOutput.
"""

from __future__ import annotations

import json
import logging

from .bot_contract import (
    AnnotatedChunk,
    BotAnnotation,
    BotInput,
    BotOutput,
    BOT_OUTPUT_SCHEMA,
)

logger = logging.getLogger(__name__)


# ── Prompt construction ────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are a mathematical proof reviewer. Your job is to read a mathematical \
argument, break it into logical chunks, and produce a structured review.

You will receive the document with block IDs as markers (e.g. [p3], [thm1]). \
Use these exact IDs when anchoring your annotations — do not invent new ones.

For each chunk of the argument:
- Summarize what it accomplishes in the overall proof structure.
- Flag any issues you find, choosing the most specific tag:
  - "gap": a genuinely missing logical step — a real hole in the reasoning
  - "handwaving": vague language that obscures what concrete step is being taken
  - "incomplete_argument": steps are skipped but could plausibly be filled in
  - "assumption_mismatch": a result is applied outside its valid context
  - "calculation_error": sign error, forgotten term, wrong inequality direction
  - "typo": spelling, grammar, or obvious notational slip
- Produce noteworthy observations as info annotations (tag "remark").
- Produce an expanded argument (tag "expanded_argument") that makes every \
logical step explicit, anchored to the chunk's block range.

Severity reflects impact on the argument's validity:
- "error": may invalidate the argument or a key step
- "warning": a real problem, but likely fixable without changing the structure
- "question": you are unsure whether this is a genuine issue

Confidence (0.0–1.0) reflects how sure YOU are about each annotation — \
not the proof's correctness.

Your summary should help a reader understand the proof's overall structure \
and where to focus attention.\
"""

PRODUCE_CHECKS_ADDENDUM = """
Additionally, mark blocks you consider logically sound with category "check" \
and tag "agent_review". This helps the human reviewer see which parts have \
been vetted.\
"""


def build_system_prompt(*, produce_checks: bool) -> str:
    prompt = SYSTEM_PROMPT
    if produce_checks:
        prompt += "\n" + PRODUCE_CHECKS_ADDENDUM
    return prompt


def build_user_prompt(bot_input: BotInput) -> str:
    """Assemble the user-facing prompt from BotInput."""
    sections = []

    # Notation
    if bot_input.context.notation:
        lines = []
        for macro, expansion in bot_input.context.notation.items():
            lines.append(f"  {macro} → {expansion}")
        sections.append("NOTATION:\n" + "\n".join(lines))

    # Referenced results
    refs = []
    for thm in bot_input.context.theorem_index:
        refs.append(f"  [{thm['id']}] ({thm['type']}): {thm.get('statement_summary', '')}")
    for defn in bot_input.context.definition_index:
        refs.append(f"  [{defn['id']}] (definition): {defn.get('statement_summary', '')}")
    if refs:
        sections.append("REFERENCED RESULTS:\n" + "\n".join(refs))

    # Document title and structure
    if bot_input.context.document_title:
        sections.append(f"DOCUMENT TITLE: {bot_input.context.document_title}")
    if bot_input.context.section_path:
        sections.append("SECTIONS: " + " > ".join(bot_input.context.section_path))

    # Document body with block markers
    body_lines = []
    for frag in bot_input.fragments:
        marker = f"[{frag.block_id}]"
        type_hint = f"({frag.block_type})" if frag.block_type != "paragraph" else ""
        label_hint = f" {{label: {frag.label}}}" if frag.label else ""
        header = f"{marker} {type_hint}{label_hint}".strip()
        body_lines.append(header)
        body_lines.append(frag.content_expanded)
        body_lines.append("")
    sections.append("DOCUMENT:\n" + "\n".join(body_lines))

    # Steering prompt
    if bot_input.config.steering_prompt:
        sections.append(f"USER INSTRUCTIONS:\n{bot_input.config.steering_prompt}")

    return "\n\n".join(sections)


# ── OpenAI API call ────────────────────────────────────────────────────


def call_openai(
    *,
    system_prompt: str,
    user_prompt: str,
    model: str,
    reasoning_effort: str,
    api_key: str,
    background: bool = True,
):
    """Call the OpenAI Responses API.

    Returns the response object (which may be in 'queued' state if
    background=True).
    """
    from openai import OpenAI

    client = OpenAI(api_key=api_key)

    kwargs = {
        "model": model,
        "instructions": system_prompt,
        "input": user_prompt,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "bot_output",
                "strict": True,
                "schema": BOT_OUTPUT_SCHEMA,
            }
        },
        "store": True,
    }

    # Reasoning parameters — only set if effort is not "none"
    if reasoning_effort and reasoning_effort != "none":
        kwargs["reasoning"] = {
            "effort": reasoning_effort,
            "summary": "auto",
        }

    if background:
        kwargs["background"] = True

    response = client.responses.create(**kwargs)
    return client, response


# ── Output parsing ─────────────────────────────────────────────────────


def parse_bot_output(raw_json: str, valid_block_ids: set[str]) -> BotOutput:
    """Parse raw JSON from the LLM into a validated BotOutput.

    Invalid block ID references are logged and skipped.
    """
    data = json.loads(raw_json)

    # Parse chunks
    chunks = []
    valid_chunk_ids = set()
    for c in data.get("chunks", []):
        # Filter source_ids to valid block IDs
        source_ids = [sid for sid in c.get("source_ids", []) if sid in valid_block_ids]
        if not source_ids:
            logger.warning("Chunk %s has no valid source_ids, skipping", c.get("chunk_id"))
            continue
        chunk = AnnotatedChunk(
            chunk_id=c["chunk_id"],
            source_ids=source_ids,
            summary=c.get("summary", ""),
            confidence=max(0.0, min(1.0, float(c.get("confidence", 0.5)))),
        )
        chunks.append(chunk)
        valid_chunk_ids.add(chunk.chunk_id)

    # Parse annotations
    annotations = []
    for a in data.get("annotations", []):
        start = a.get("start_block", "")
        end = a.get("end_block", start)

        # Validate block references
        if start not in valid_block_ids:
            logger.warning("Annotation references invalid start_block %s, skipping", start)
            continue
        if end not in valid_block_ids:
            end = start  # Fall back to single-block

        # Validate chunk reference
        chunk_id = a.get("chunk_id", "")
        if chunk_id and chunk_id not in valid_chunk_ids:
            logger.warning("Annotation references unknown chunk_id %s", chunk_id)
            # Still keep the annotation, just with the chunk_id as-is

        category = a.get("category", "info")
        if category not in ("check", "info", "issue"):
            category = "info"

        severity = a.get("severity", "")
        if category == "issue" and severity not in ("question", "warning", "error"):
            severity = "question"  # default for issues
        elif category != "issue":
            severity = ""

        ann = BotAnnotation(
            start_block=start,
            end_block=end,
            category=category,
            tags=a.get("tags", []),
            severity=severity,
            body=a.get("body", ""),
            confidence=max(0.0, min(1.0, float(a.get("confidence", 0.5)))),
            chunk_id=chunk_id,
        )
        annotations.append(ann)

    return BotOutput(
        summary=data.get("summary", ""),
        chunks=chunks,
        annotations=annotations,
        overall_confidence=max(0.0, min(1.0, float(data.get("overall_confidence", 0.5)))),
    )
