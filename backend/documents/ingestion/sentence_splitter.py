"""Math-aware sentence splitting for mathematical prose."""

import re


def split_sentences(text: str) -> list[dict]:
    """Split a paragraph into sentences, respecting math delimiters.

    Does not break on periods inside $...$, $$...$$, or \\(...\\).

    Returns list of {"id_suffix": "s1", "text": "...",
                      "offset_start": int, "offset_end": int}
    """
    if not text.strip():
        return []

    # Find all math regions to protect
    math_regions = _find_math_regions(text)

    # Find candidate split points: period followed by whitespace + uppercase,
    # or period at end of string
    candidates = []
    for m in re.finditer(r"\.\s+(?=[A-Z\\$])|\.(?:\s*$)", text):
        dot_pos = m.start()
        if not _inside_math(dot_pos, math_regions):
            # Split after the period
            candidates.append(dot_pos + 1)

    if not candidates:
        return [
            {
                "id_suffix": "s1",
                "text": text.strip(),
                "offset_start": 0,
                "offset_end": len(text),
            }
        ]

    # Build sentences from split points
    sentences = []
    start = 0
    for i, split_pos in enumerate(candidates):
        sentence_text = text[start:split_pos].strip()
        if sentence_text:
            sentences.append(
                {
                    "id_suffix": f"s{i + 1}",
                    "text": sentence_text,
                    "offset_start": start,
                    "offset_end": split_pos,
                }
            )
        # Skip whitespace after the split
        start = split_pos
        while start < len(text) and text[start] in " \t\n":
            start += 1

    # Remainder after last split
    remainder = text[start:].strip()
    if remainder:
        sentences.append(
            {
                "id_suffix": f"s{len(sentences) + 1}",
                "text": remainder,
                "offset_start": start,
                "offset_end": len(text),
            }
        )

    return sentences


def _find_math_regions(text: str) -> list[tuple[int, int]]:
    """Find all math-mode regions in text."""
    regions = []

    # Display math: $$...$$ (must come before inline)
    for m in re.finditer(r"\$\$.*?\$\$", text, re.DOTALL):
        regions.append((m.start(), m.end()))

    # Inline math: $...$  (not $$)
    for m in re.finditer(r"(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)", text, re.DOTALL):
        regions.append((m.start(), m.end()))

    # \(...\)
    for m in re.finditer(r"\\\(.*?\\\)", text, re.DOTALL):
        regions.append((m.start(), m.end()))

    # \[...\]
    for m in re.finditer(r"\\\[.*?\\\]", text, re.DOTALL):
        regions.append((m.start(), m.end()))

    return regions


def _inside_math(pos: int, regions: list[tuple[int, int]]) -> bool:
    """Check if a position is inside any math region."""
    return any(start <= pos < end for start, end in regions)
