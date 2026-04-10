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


_COMMAND_NAME_RE = re.compile(r"[A-Za-z@]+")
_NEWCOMMAND_START_RE = re.compile(r"\\(?:re)?newcommand\*?")
_DECLAREMATHOP_START_RE = re.compile(r"\\DeclareMathOperator\*?")
_DEF_START_RE = re.compile(r"\\def\\([A-Za-z@]+)")

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

    text = _strip_comments(preamble)

    for start in _NEWCOMMAND_START_RE.finditer(text):
        parsed = _parse_newcommand(text, start.end())
        if parsed:
            name, arity, body = parsed
            macros[name] = {"expansion": body.strip(), "arity": arity}

    for start in _DECLAREMATHOP_START_RE.finditer(text):
        parsed = _parse_declare_math_operator(text, start.end())
        if parsed:
            name, body = parsed
            macros[name] = {
                "expansion": f"\\operatorname{{{body.strip()}}}",
                "arity": 0,
            }

    for start in _DEF_START_RE.finditer(text):
        parsed = _parse_def(text, start)
        if parsed:
            name, arity, body = parsed
            macros[name] = {"expansion": body.strip(), "arity": arity}

    return macros


def _strip_comments(source: str) -> str:
    """Remove LaTeX comments while preserving escaped percent signs."""
    out: list[str] = []
    i = 0
    while i < len(source):
        ch = source[i]
        if ch == "%" and not _is_escaped(source, i):
            while i < len(source) and source[i] != "\n":
                i += 1
            if i < len(source):
                out.append("\n")
                i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _is_escaped(source: str, pos: int) -> bool:
    backslashes = 0
    i = pos - 1
    while i >= 0 and source[i] == "\\":
        backslashes += 1
        i -= 1
    return backslashes % 2 == 1


def _skip_ws(source: str, pos: int) -> int:
    while pos < len(source) and source[pos].isspace():
        pos += 1
    return pos


def _read_balanced(
    source: str, pos: int, open_ch: str = "{", close_ch: str = "}"
) -> tuple[str, int] | None:
    """Read a balanced LaTeX group, returning inner text and next position."""
    pos = _skip_ws(source, pos)
    if pos >= len(source) or source[pos] != open_ch:
        return None

    depth = 1
    i = pos + 1
    while i < len(source):
        ch = source[i]
        if ch == open_ch and not _is_escaped(source, i):
            depth += 1
        elif ch == close_ch and not _is_escaped(source, i):
            depth -= 1
            if depth == 0:
                return source[pos + 1 : i], i + 1
        i += 1
    return None


def _read_optional_bracket(source: str, pos: int) -> tuple[str, int] | None:
    return _read_balanced(source, pos, "[", "]")


def _read_latex_command(source: str, pos: int) -> tuple[str, int] | None:
    pos = _skip_ws(source, pos)
    if pos >= len(source) or source[pos] != "\\":
        return None
    match = _COMMAND_NAME_RE.match(source, pos + 1)
    if match:
        return "\\" + match.group(0), match.end()
    if pos + 1 < len(source):
        return source[pos : pos + 2], pos + 2
    return None


def _read_macro_name(source: str, pos: int) -> tuple[str, int] | None:
    pos = _skip_ws(source, pos)
    if pos < len(source) and source[pos] == "{":
        grouped = _read_balanced(source, pos)
        if not grouped:
            return None
        name_text, end = grouped
        command = _read_latex_command(name_text.strip(), 0)
        if not command:
            return None
        return command[0], end
    return _read_latex_command(source, pos)


def _parse_newcommand(source: str, pos: int) -> tuple[str, int, str] | None:
    name_result = _read_macro_name(source, pos)
    if not name_result:
        return None
    name, pos = name_result

    arity = 0
    bracket = _read_optional_bracket(source, pos)
    if bracket:
        arity_text, pos = bracket
        if arity_text.strip().isdigit():
            arity = int(arity_text.strip())
            # Optional-argument defaults look like \newcommand{\x}[2][d]{...}.
            default_arg = _read_optional_bracket(source, pos)
            if default_arg:
                pos = default_arg[1]

    body = _read_balanced(source, pos)
    if not body:
        return None
    return name, arity, body[0]


def _parse_declare_math_operator(
    source: str, pos: int
) -> tuple[str, str] | None:
    name_result = _read_macro_name(source, pos)
    if not name_result:
        return None
    name, pos = name_result
    body = _read_balanced(source, pos)
    if not body:
        return None
    return name, body[0]


def _parse_def(source: str, match: re.Match) -> tuple[str, int, str] | None:
    name = "\\" + match.group(1)
    pos = match.end()
    body_start = source.find("{", pos)
    if body_start == -1:
        return None
    params = source[pos:body_start]
    arity = max((int(n) for n in re.findall(r"#([1-9])", params)), default=0)
    body = _read_balanced(source, body_start)
    if not body:
        return None
    return name, arity, body[0]


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
