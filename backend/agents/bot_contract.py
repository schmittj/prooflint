"""
Bot contract — dataclasses for bot input/output and the JSON schema
used for OpenAI structured output.

All bots (GlobalAnnotatorBot, future LiteratureBot, etc.) share these
shapes so the orchestration layer doesn't care how a bot produces output.
"""

from __future__ import annotations

from dataclasses import dataclass, field


# ── Input ──────────────────────────────────────────────────────────────


@dataclass
class FragmentBlock:
    block_id: str  # e.g. "p3"
    block_type: str  # e.g. "paragraph", "theorem"
    content_expanded: str  # Macro-expanded text
    content_original: str  # Original text
    sentences: list[dict] = field(default_factory=list)  # [{"id": "p3.s1", "text": "..."}]
    label: str = ""  # LaTeX label, if any


@dataclass
class ContextSlice:
    notation: dict[str, str] = field(default_factory=dict)  # {"\\mcG": "\\mathcal{G}", ...}
    theorem_index: list[dict] = field(default_factory=list)  # [{"id": "thm1", "type": "theorem", "statement": "..."}]
    definition_index: list[dict] = field(default_factory=list)
    document_title: str = ""
    section_path: list[str] = field(default_factory=list)  # ["§2 Preliminaries", ...]
    total_blocks: int = 0
    bibliography: list[dict] = field(default_factory=list)  # post-MVP


@dataclass
class BotConfig:
    model: str = "gpt-5.4"
    reasoning_effort: str = "xhigh"
    preset: str = "triage"
    steering_prompt: str = ""
    options: dict = field(default_factory=dict)  # e.g. {"produce_checks": True}


@dataclass
class BotInput:
    fragments: list[FragmentBlock]
    context: ContextSlice
    config: BotConfig


# ── Output ─────────────────────────────────────────────────────────────


@dataclass
class AnnotatedChunk:
    chunk_id: str  # e.g. "chunk_1"
    source_ids: list[str]  # Block IDs this chunk covers: ["p3", "p4"]
    summary: str  # What this chunk does logically
    confidence: float  # Per-chunk confidence 0.0–1.0


@dataclass
class BotAnnotation:
    """Matches the Annotation v2 creation shape."""

    # Anchor
    start_block: str  # e.g. "p3"
    end_block: str  # e.g. "p3" (same for single-block)

    # Content
    category: str  # "check", "info", or "issue"
    tags: list[str]  # e.g. ["gap"], ["expanded_argument"], ["agent_review"]
    severity: str  # "question", "warning", "error" (required for issues; empty otherwise)
    body: str  # Human-readable explanation
    confidence: float  # How confident the bot is in this annotation

    # Grouping
    chunk_id: str  # References AnnotatedChunk.chunk_id


@dataclass
class BotOutput:
    summary: str
    chunks: list[AnnotatedChunk]
    annotations: list[BotAnnotation]
    overall_confidence: float  # 0.0–1.0


# ── JSON Schema for OpenAI structured output ───────────────────────────

BOT_OUTPUT_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "summary": {
            "type": "string",
            "description": "Overall summary of the analyzed argument.",
        },
        "chunks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "chunk_id": {"type": "string"},
                    "source_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "summary": {"type": "string"},
                    "confidence": {"type": "number"},
                },
                "required": ["chunk_id", "source_ids", "summary", "confidence"],
                "additionalProperties": False,
            },
        },
        "annotations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "start_block": {"type": "string"},
                    "end_block": {"type": "string"},
                    "category": {
                        "type": "string",
                        "enum": ["check", "info", "issue"],
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "severity": {
                        "type": "string",
                        "enum": ["", "question", "warning", "error"],
                    },
                    "body": {"type": "string"},
                    "confidence": {"type": "number"},
                    "chunk_id": {"type": "string"},
                },
                "required": [
                    "start_block",
                    "end_block",
                    "category",
                    "tags",
                    "severity",
                    "body",
                    "confidence",
                    "chunk_id",
                ],
                "additionalProperties": False,
            },
        },
        "overall_confidence": {"type": "number"},
    },
    "required": ["summary", "chunks", "annotations", "overall_confidence"],
    "additionalProperties": False,
}
