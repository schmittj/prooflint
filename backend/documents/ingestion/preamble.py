"""Extract macro definitions and \\newtheorem declarations from LaTeX preambles."""

import re


def extract_preamble(source: str) -> tuple[str, str]:
    """Split LaTeX source into preamble and body.

    Returns (preamble, body). For Markdown input, preamble is empty.
    """
    match = re.search(r"\\begin\{document\}", source)
    if not match:
        return "", source

    preamble = source[: match.start()]
    end_match = re.search(r"\\end\{document\}", source)
    if end_match:
        body = source[match.end() : end_match.start()]
    else:
        body = source[match.end() :]
    return preamble, body


# Patterns for macro definitions
_NEWCOMMAND_RE = re.compile(
    r"\\(?:re)?newcommand\{?\\(\w+)\}?"  # \newcommand{\name} or \newcommand\name
    r"(?:\[(\d+)\])?"  # optional [arity]
    r"\{((?:[^{}]|\{[^{}]*\})*)\}",  # {body} (one level of nesting)
    re.DOTALL,
)

_DECLAREMATHOP_RE = re.compile(
    r"\\DeclareMathOperator\{\\(\w+)\}\{([^}]*)\}"
)

_DEF_RE = re.compile(
    r"\\def\\(\w+)\{((?:[^{}]|\{[^{}]*\})*)\}"
)

_NEWTHEOREM_RE = re.compile(
    r"\\newtheorem\{(\w+)\}"  # {envname}
    r"(?:\[(\w+)\])?"  # optional [counter]
    r"\{([^}]+)\}"  # {Display Name}
    r"(?:\[(\w+)\])?",  # optional [within]
)


def extract_macros(preamble: str) -> dict:
    """Extract macro definitions from a LaTeX preamble.

    Returns {"macros": {command: {"expansion": ..., "arity": ...}}}
    """
    macros = {}

    for m in _NEWCOMMAND_RE.finditer(preamble):
        name = m.group(1)
        arity = int(m.group(2)) if m.group(2) else 0
        body = m.group(3).strip()
        macros[f"\\{name}"] = {"expansion": body, "arity": arity}

    for m in _DECLAREMATHOP_RE.finditer(preamble):
        name = m.group(1)
        text = m.group(2)
        macros[f"\\{name}"] = {
            "expansion": f"\\operatorname{{{text}}}",
            "arity": 0,
        }

    for m in _DEF_RE.finditer(preamble):
        name = m.group(1)
        body = m.group(2).strip()
        macros[f"\\{name}"] = {"expansion": body, "arity": 0}

    return macros


def extract_theorem_envs(preamble: str) -> dict:
    """Extract \\newtheorem declarations.

    Returns {envname: {"display_name": ..., "counter": ..., "within": ...}}
    """
    envs = {}
    for m in _NEWTHEOREM_RE.finditer(preamble):
        envname = m.group(1)
        counter = m.group(2)  # shared counter, or None
        display_name = m.group(3)
        within = m.group(4)  # numbered within, or None
        envs[envname] = {
            "display_name": display_name,
            "counter": counter,
            "within": within,
        }
    return envs
