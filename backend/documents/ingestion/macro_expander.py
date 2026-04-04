"""Expand user-defined macros in LaTeX/Markdown source text."""

import re


def expand_macros(
    source: str, macros: dict
) -> tuple[str, list[dict]]:
    """Expand macros in source text.

    Args:
        source: The document body text.
        macros: Dict of {command: {"expansion": ..., "arity": ...}}.

    Returns:
        (expanded_source, source_map) where source_map is a list of
        {"orig_start", "orig_end", "exp_start", "exp_end"} entries.
    """
    if not macros:
        return source, []

    # Sort by command length (longest first) to avoid partial matches
    sorted_commands = sorted(macros.keys(), key=len, reverse=True)

    # Build pattern: match any command, optionally followed by {arg} groups
    # We process one substitution at a time to maintain offset tracking
    source_map = []
    result = []
    pos = 0
    exp_pos = 0

    while pos < len(source):
        matched = False
        for cmd in sorted_commands:
            if not source[pos:].startswith(cmd):
                continue

            # Check that the command isn't part of a longer command name
            end_of_cmd = pos + len(cmd)
            if end_of_cmd < len(source) and source[end_of_cmd].isalpha():
                continue

            macro = macros[cmd]
            arity = macro["arity"]
            expansion = macro["expansion"]

            # Parse arguments
            arg_end = end_of_cmd
            args = []
            for _ in range(arity):
                # Skip whitespace
                while arg_end < len(source) and source[arg_end] in " \t\n":
                    arg_end += 1
                if arg_end < len(source) and source[arg_end] == "{":
                    # Find matching brace
                    depth = 1
                    j = arg_end + 1
                    while j < len(source) and depth > 0:
                        if source[j] == "{":
                            depth += 1
                        elif source[j] == "}":
                            depth -= 1
                        j += 1
                    args.append(source[arg_end + 1 : j - 1])
                    arg_end = j
                else:
                    # No brace — take single next token
                    if arg_end < len(source):
                        args.append(source[arg_end])
                        arg_end += 1

            # Substitute arguments into expansion
            expanded = expansion
            for i, arg in enumerate(args):
                expanded = expanded.replace(f"#{i + 1}", arg)

            # Record the mapping
            source_map.append(
                {
                    "orig_start": pos,
                    "orig_end": arg_end,
                    "exp_start": exp_pos,
                    "exp_end": exp_pos + len(expanded),
                }
            )

            result.append(expanded)
            exp_pos += len(expanded)
            pos = arg_end
            matched = True
            break

        if not matched:
            result.append(source[pos])
            exp_pos += 1
            pos += 1

    return "".join(result), source_map
