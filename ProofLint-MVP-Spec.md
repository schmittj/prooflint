# ProofLint — MVP Technical Specification

**Version**: 0.2 (Revised — incorporates review feedback)
**Date**: 2026-04-04
**Status**: Pre-development

---

## 1. Product Summary

ProofLint is a browser-based tool that ingests mathematical writing (LaTeX or Markdown+LaTeX), renders it in a standardized format with stable structural IDs, and overlays AI-generated annotations to help a human expert review proofs. The MVP targets 1–2 page mathematical arguments and delivers: document ingestion/rendering, a single GlobalAnnotator agent pass, human annotations, a chatbot sidebar, and a structural summary panel.

### 1.1 Design Principles

- **Human-in-the-loop**: AI flags and explains; the human decides. No verdicts, only evidence.
- **Grounding first**: Every annotation is anchored to a stable document ID. Deterministic mapping from agent output to rendered position — no fuzzy matching.
- **Modular agents**: Each annotation type is produced by a pluggable agent conforming to a standard contract. The system is designed so new agents can be added without modifying core infrastructure.
- **Contributor-friendly**: Clear separation of concerns, typed interfaces, standard tooling, Docker-based dev environment.

### 1.2 Effort Presets

| Preset | What runs | Use case |
|---|---|---|
| **Manual** | Ingest + render only; tools invoked manually on demand | Interactive workbench |
| **Triage** | + Global summary, one-pass vetting with flags, confidence summary | Quick review: "what should I pay attention to?" |
| **Audit** | + Full paragraph-by-paragraph vetting (post-MVP agents) | Deep review |

The MVP implements Manual and Triage. Audit is the extension point for post-MVP agents.

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Browser (React + TS)                      │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │   Document    │  │  Annotation  │  │   Summary Sidebar +    │  │
│  │   Reader      │  │  Panel       │  │   Chatbot              │  │
│  │  (MathJax 3)  │  │              │  │                        │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬────────────┘  │
│         │                 │                       │               │
│         └─────────────────┼───────────────────────┘               │
│                           │  Zustand stores                      │
│                           │                                      │
└───────────────────────────┼──────────────────────────────────────┘
                            │ REST API (JSON)
┌───────────────────────────┼──────────────────────────────────────┐
│                    Django + DRF Backend                           │
│                                                                  │
│  ┌────────────┐  ┌────────────────┐  ┌────────────────────────┐  │
│  │ documents   │  │  annotations   │  │  agents                │  │
│  │ app         │  │  app           │  │  app                   │  │
│  │             │  │                │  │                        │  │
│  │ - Upload    │  │ - Human flags  │  │ - Agent orchestration  │  │
│  │ - Ingest    │  │ - AI flags     │  │ - GlobalAnnotator      │  │
│  │ - Retrieve  │  │ - Status       │  │ - Chat relay           │  │
│  └──────┬─────┘  └────────────────┘  └───────────┬────────────┘  │
│         │                                         │               │
│         ▼                                         ▼               │
│  ┌────────────┐                          ┌────────────────────┐  │
│  │  Ingestion  │                          │  LLM Provider      │  │
│  │  Pipeline   │                          │  (OpenAI/Anthropic │  │
│  │  (Pandoc)   │                          │   via API keys)    │  │
│  └────────────┘                          └────────────────────┘  │
│                                                                  │
│                      PostgreSQL                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.1 Component Summary

| Component | Technology | Role |
|---|---|---|
| Frontend | React 18, TypeScript, Vite, Zustand, MathJax 3 | Document rendering, annotation UI, chat |
| Backend API | Django 5, Django REST Framework | REST API, orchestration, storage |
| Ingestion | Pandoc (subprocess), panflute (AST manipulation) | LaTeX/Markdown → structured blocks with IDs |
| Database | PostgreSQL 16 | Documents, blocks, annotations, chat history |
| LLM access | httpx / openai / anthropic SDKs | Agent calls, chat relay |
| TikZ rendering | TeX Live (optional, Docker) | TikZ/tikzcd → SVG |
| Dev environment | Docker Compose | Postgres, backend, frontend, optional TeX |

---

## 3. Ingestion Pipeline

The ingestion pipeline is the foundational layer. Its job: take raw input, produce a structured document with stable IDs that agents and the UI can reference deterministically.

### 3.1 Supported Input Formats

1. **Markdown + inline LaTeX** — Primary format. Standard output of frontier AI models. Pandoc parses natively.
2. **LaTeX (.tex)** — Full LaTeX documents with preamble. Pandoc parses with `--from latex`.
3. **Raw paste** — Text pasted directly into the UI, treated as Markdown+LaTeX.

File upload and paste are both supported. For LaTeX input, the raw `.tex` source is stored as ground truth.

### 3.2 Pipeline Steps

```
Input (LaTeX or Markdown+LaTeX)
  │
  ▼
┌─────────────────────────┐
│ 1. Preamble Extraction  │  (LaTeX only)
│    Extract \newcommand,  │
│    \def, \DeclareMath-   │
│    Operator, \newtheorem │
│    declarations, packages│
│    → MacroTable +        │
│      TheoremEnvTable     │
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 2. Macro Expansion      │
│    Mechanically expand   │
│    user-defined macros   │
│    in the document body  │
│    → expanded source     │
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 3. Pandoc Parse         │
│    Input → Pandoc AST    │
│    via panflute filter   │
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 4. AST Processing       │
│    - Assign block IDs    │
│    - Detect environments │
│      (theorem, proof,    │
│       lemma, definition) │
│    - Extract structure   │
│      (sections, labels)  │
│    - Identify TikZ blocks│
│    - Record source spans │
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 5. TikZ Rendering       │  (optional, if TeX available)
│    RawBlock(tikz) →      │
│    standalone .tex →     │
│    pdflatex → SVG        │
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 6. Store                │
│    Document + Blocks +   │
│    MacroTable + rendered │
│    assets → DB + media   │
└─────────────────────────┘
```

### 3.3 Block ID Assignment

Every structural element in the document gets a stable, hierarchical ID. The ID scheme:

| Element type | ID pattern | Example |
|---|---|---|
| Section | `sec{n}` | `sec1`, `sec2` |
| Paragraph | `p{n}` | `p1`, `p2`, `p12` |
| Sentence | `p{n}.s{m}` | `p3.s1`, `p3.s2` |
| Display equation | `eq{n}` | `eq1`, `eq5` |
| Theorem-like env | `{type}{n}` | `thm1`, `lem2`, `def3` |
| Proof env | `pf{n}` | `pf1`, `pf2` |
| Figure / TikZ | `fig{n}` | `fig1`, `fig2` |
| List item | `p{n}.li{m}` | `p7.li1`, `p7.li3` |

IDs are assigned by sequential document-order traversal of the AST. They are stable: re-ingesting the same source produces the same IDs.

**Sentence splitting**: Within a paragraph, sentences are split using a math-aware splitter. The splitter must not break on periods inside `$...$` or `$$...$$`. We use a rule-based approach: split on `.` followed by whitespace and an uppercase letter or end-of-paragraph, excluding content inside math delimiters. This is imperfect but sufficient for MVP — agents can work at the paragraph level when sentence boundaries are ambiguous.

**Source span recording**: Each block stores the byte offset range `(start, end)` in the original source. This enables "view source" and survives re-rendering.

### 3.4 Macro Expansion

Macro expansion runs before Pandoc parsing. It operates on raw source text.

**What we expand:**
- `\newcommand{\name}[args]{body}` — simple textual substitution
- `\renewcommand` — same
- `\DeclareMathOperator{\name}{text}` — expands to `\operatorname{text}`
- `\def\name{body}` — simple cases only (no TeX parameter tricks)

**What we parse but don't expand:**
- `\newtheorem{envname}{Display Name}[counter]` — parsed to build a theorem environment table so the AST processor can correctly identify `\begin{prop}` as a Proposition environment, even for custom declarations. The table maps environment names to their display names and counter relationships.

**What we don't expand (MVP):**
- Macros with complex TeX parameter patterns (`#1#2` with delimiters)
- Package-provided commands (these are standard LaTeX, Pandoc/MathJax handle them)
- `\newenvironment` definitions (handled at the AST level instead)

**Storage:** Both original and expanded versions of each block are stored. The original is displayed; the expanded version is sent to agents.

**Source mapping:** Macro expansion changes character offsets. Since blocks store offsets into the *original* source (before expansion), we must track the mapping. During expansion, we build a source map: a list of `(original_range, expanded_range)` tuples recording each substitution. This is stored on the Document alongside the macro table. The source map enables:
- Accurate "view source" from any block back to the original `.tex`
- Correct offset computation when the expanded version is what Pandoc actually parses

**Macro table structure:**

```python
# Stored as JSON in the Document model
{
    "macros": {
        "\\mcG": {"expansion": "\\mathcal{G}", "arity": 0},
        "\\adm": {"expansion": "#1\\text{-admissible}", "arity": 1},
        "\\chr": {"expansion": "\\operatorname{chr}", "arity": 0}
    }
}
```

### 3.5 TikZ Rendering

TikZ/tikzcd environments are detected in the AST as `RawBlock "latex"` nodes whose content contains `\begin{tikzpicture}` or `\begin{tikzcd}`.

**Rendering pipeline:**

1. Wrap the raw TikZ source in a minimal standalone document:
   ```latex
   \documentclass[crop,tikz]{standalone}
   \usepackage{tikz-cd}
   % ... other detected packages
   \begin{document}
   [tikz source here]
   \end{document}
   ```
2. Compile with `pdflatex` (or `lualatex` for Unicode-heavy content)
3. Convert PDF → SVG via `pdf2svg` or `dvisvgm`
4. Store SVG in media directory, reference from block

**If TeX is not available:** The block renders as a bordered placeholder showing syntax-highlighted LaTeX source with a note: "Install TeX Live for diagram rendering." The raw source is always accessible regardless.

**For MVP:** TikZ rendering is a nice-to-have. The primary use case (Markdown+LaTeX from AI models) rarely contains TikZ. We implement the detection and placeholder path; the full rendering pipeline is enabled when TeX Live is present in the Docker environment.

---

## 4. Data Models

### 4.1 Document

The top-level container for an ingested document.

```python
class Document(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    title = models.CharField(max_length=500, blank=True)
    
    # Source
    original_source = models.TextField()  # Raw input as uploaded
    source_format = models.CharField(
        max_length=20,
        choices=[("latex", "LaTeX"), ("markdown", "Markdown+LaTeX")]
    )
    
    # Processed content
    macro_table = models.JSONField(default=dict)  # Extracted macro definitions
    theorem_env_table = models.JSONField(default=dict)  # \newtheorem declarations
    # Example: {"prop": {"display_name": "Proposition", "counter": "theorem"},
    #           "defn": {"display_name": "Definition", "counter": null}}
    expanded_source = models.TextField()  # Source with macros expanded
    source_map = models.JSONField(default=list)  # Offset map: original ↔ expanded
    # List of {"orig_start": int, "orig_end": int, "exp_start": int, "exp_end": int}
    
    # Structure (built during ingestion)
    structure = models.JSONField(default=dict)
    # Example:
    # {
    #   "sections": [{"id": "sec1", "title": "Introduction", "block_ids": ["p1","p2"]}],
    #   "theorem_index": [
    #     {"id": "thm1", "type": "theorem", "label": "thm:main",
    #      "statement_summary": "Every admissible graph..."}
    #   ],
    #   "definition_index": [...],
    #   "label_map": {"thm:main": "thm1", "lem:del": "lem2"}
    # }
    
    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # Agent state
    preset = models.CharField(
        max_length=20,
        choices=[("manual", "Manual"), ("triage", "Triage"), ("audit", "Audit")],
        default="manual"
    )
    agent_status = models.CharField(
        max_length=20,
        choices=[
            ("idle", "Idle"),
            ("running", "Running"),
            ("completed", "Completed"),
            ("failed", "Failed")
        ],
        default="idle"
    )
```

### 4.2 Block

A structural unit of the document: a paragraph, theorem, equation, proof, figure, etc.

```python
class Block(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    document = models.ForeignKey(Document, related_name="blocks", on_delete=models.CASCADE)
    
    # Document-local display ID (e.g. "p3", "thm1", "pf1.p2")
    # This is what agents, the UI, and annotations reference.
    # Unique within a document, not globally.
    block_id = models.CharField(max_length=50)
    
    # Ordering and hierarchy
    order = models.PositiveIntegerField()  # Position in document
    parent = models.ForeignKey(
        "self", null=True, blank=True,
        related_name="children", on_delete=models.CASCADE
    )
    
    # Type
    block_type = models.CharField(max_length=30, choices=[
        ("paragraph", "Paragraph"),
        ("theorem", "Theorem"),
        ("lemma", "Lemma"),
        ("proposition", "Proposition"),
        ("corollary", "Corollary"),
        ("definition", "Definition"),
        ("remark", "Remark"),
        ("proof", "Proof"),
        ("equation", "Display Equation"),
        ("figure", "Figure"),
        ("section_heading", "Section Heading"),
        ("list", "List"),
        ("raw_latex", "Raw LaTeX (TikZ etc.)"),
    ])
    
    # Content
    content_original = models.TextField()  # As written (macros intact)
    content_expanded = models.TextField()  # Macros expanded
    content_html = models.TextField(blank=True)  # Pre-rendered HTML (optional)
    
    # Source mapping (byte offsets in the ORIGINAL source, before macro expansion)
    source_offset_start = models.PositiveIntegerField()
    source_offset_end = models.PositiveIntegerField()
    
    # Sentence decomposition (for paragraphs and proofs)
    sentences = models.JSONField(default=list)
    # Example:
    # [
    #   {"id": "p3.s1", "text": "We proceed by induction on $|V(G)|$.",
    #    "offset_start": 0, "offset_end": 45},
    #   {"id": "p3.s2", "text": "The base case is trivial.",
    #    "offset_start": 46, "offset_end": 71}
    # ]
    
    # TikZ rendering (for figures/raw_latex)
    rendered_svg_path = models.CharField(max_length=500, blank=True)
    
    # Labels (LaTeX \label{})
    label = models.CharField(max_length=200, blank=True)
    
    class Meta:
        ordering = ["order"]
        constraints = [
            models.UniqueConstraint(
                fields=["document", "block_id"],
                name="unique_block_id_per_document"
            )
        ]
```

### 4.3 Annotation

Both human annotations and AI-generated flags live in the same model, distinguished by `source`.

```python
class Annotation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    document = models.ForeignKey(Document, related_name="annotations", on_delete=models.CASCADE)
    
    # Anchoring — multi-level precision
    block_id = models.CharField(max_length=50)     # Required: which block (e.g. "p3")
    sentence_id = models.CharField(max_length=50, blank=True)  # Optional: sentence within block
    
    # Character-range anchoring (for precise human selections within a block)
    # These are character offsets within the block's content_original.
    anchor_offset_start = models.PositiveIntegerField(null=True, blank=True)
    anchor_offset_end = models.PositiveIntegerField(null=True, blank=True)
    
    # Quote-based recovery: the exact selected text. If offsets become stale
    # (e.g. after re-ingestion), this allows fuzzy re-anchoring.
    anchor_quote = models.TextField(blank=True)
    
    # Source
    source = models.CharField(max_length=20, choices=[
        ("human", "Human"),
        ("agent", "AI Agent"),
    ])
    agent_run = models.ForeignKey(
        "agents.AgentRun", null=True, blank=True,
        related_name="annotations", on_delete=models.SET_NULL
    )
    chunk = models.ForeignKey(
        "agents.Chunk", null=True, blank=True,
        related_name="annotations", on_delete=models.SET_NULL
    )
    
    # Content
    annotation_type = models.CharField(max_length=30, choices=[
        # AI flag types
        ("gap", "Logical Gap"),
        ("error", "Potential Error"),
        ("handwave", "Handwaving"),
        ("unclear", "Unclear"),
        ("assumption", "Unverified Assumption"),
        ("info", "Informational Note"),
        # Human flag types
        ("comment", "Comment"),
        ("checked", "Checked / Verified"),
        ("needs_review", "Needs Review"),
        ("logic_mistake", "Logic Mistake"),
    ])
    severity = models.CharField(max_length=20, choices=[
        ("info", "Info"),
        ("warning", "Warning"),
        ("error", "Error"),
    ], default="info")
    message = models.TextField()
    
    # AI metadata
    confidence = models.FloatField(null=True, blank=True)  # 0.0–1.0
    
    # Human metadata
    resolved = models.BooleanField(default=False)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ["block_id", "created_at"]
```

### 4.4 Chunk

Persists the logical chunks produced by an agent run. This is where `expanded_argument` lives — chunks group blocks into logical steps and carry the AI's detailed analysis. Annotations link back to their parent chunk via a foreign key.

```python
class Chunk(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    agent_run = models.ForeignKey("agents.AgentRun", related_name="chunks", on_delete=models.CASCADE)
    document = models.ForeignKey(Document, related_name="chunks", on_delete=models.CASCADE)
    
    # Identity
    chunk_id = models.CharField(max_length=50)  # e.g. "chunk_1" (local to the agent run)
    
    # Which blocks this chunk covers
    source_block_ids = models.JSONField()  # ["p3", "p4", "p5"]
    
    # Agent analysis
    summary = models.TextField()
    expanded_argument = models.TextField(blank=True)  # Detailed version filling logical leaps
    confidence = models.FloatField()  # 0.0–1.0
    
    # Ordering (within the agent run's output)
    order = models.PositiveIntegerField()
    
    class Meta:
        ordering = ["order"]
```

The "Expand argument" UI feature reads `expanded_argument` from the Chunk, not from individual Annotations. This correctly models the agent output: chunks are logical units of the proof, and the expanded argument fills gaps across the entire chunk, not per-flag.

### 4.5 AgentRun

Tracks invocations of AI agents against a document.

```python
class AgentRun(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    document = models.ForeignKey(Document, related_name="agent_runs", on_delete=models.CASCADE)
    
    agent_type = models.CharField(max_length=50)  # e.g. "global_annotator"
    status = models.CharField(max_length=20, choices=[
        ("pending", "Pending"),
        ("running", "Running"),
        ("completed", "Completed"),
        ("failed", "Failed"),
    ])
    
    # Configuration
    model = models.CharField(max_length=100)  # e.g. "claude-sonnet-4-6"
    preset = models.CharField(max_length=20)  # Which preset triggered this
    config = models.JSONField(default=dict)  # Additional agent config
    
    # Results
    raw_output = models.JSONField(null=True, blank=True)  # Full agent response
    error_message = models.TextField(blank=True)
    
    # Cost tracking
    input_tokens = models.PositiveIntegerField(null=True, blank=True)
    output_tokens = models.PositiveIntegerField(null=True, blank=True)
    
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
```

### 4.6 ChatMessage

Persistent chat history per document.

```python
class ChatMessage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    document = models.ForeignKey(Document, related_name="chat_messages", on_delete=models.CASCADE)
    
    role = models.CharField(max_length=20, choices=[
        ("user", "User"),
        ("assistant", "Assistant"),
        ("system", "System"),
    ])
    content = models.TextField()
    
    # Optional: what text was selected when the message was sent
    selected_block_id = models.CharField(max_length=50, blank=True)
    selected_text = models.TextField(blank=True)
    
    # Metadata
    model = models.CharField(max_length=100, blank=True)
    input_tokens = models.PositiveIntegerField(null=True, blank=True)
    output_tokens = models.PositiveIntegerField(null=True, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ["created_at"]
```

---

## 5. Agent Contract

### 5.1 Standard Agent Interface

All agents conform to the same input/output contract. This makes agents pluggable: the system doesn't care how an agent produces its output, only that the shapes match.

**Agent Input:**

```python
@dataclass
class AgentInput:
    # The document fragment to analyze (expanded macros)
    fragments: list[FragmentBlock]
    
    # Context built by the preprocessing pass
    context: ContextSlice
    
    # Agent configuration
    config: AgentConfig


@dataclass
class FragmentBlock:
    block_id: str              # e.g. "p3"
    block_type: str            # e.g. "paragraph", "theorem"
    content_expanded: str      # Macro-expanded text
    content_original: str      # Original text
    sentences: list[dict]      # [{"id": "p3.s1", "text": "..."}]
    label: str                 # LaTeX label, if any


@dataclass
class ContextSlice:
    # Notation/macro table (what symbols mean)
    notation: dict[str, str]   # {"\\mcG": "\\mathcal{G}", ...}
    
    # Theorems/definitions referenced or nearby
    theorem_index: list[dict]  # [{"id": "thm1", "type": "theorem", "statement": "..."}]
    definition_index: list[dict]
    
    # Document structure for orientation
    document_title: str
    section_path: list[str]    # ["§2 Preliminaries", "§2.1 Graph colorings"]
    total_blocks: int
    
    # Bibliography entries (post-MVP, empty for now)
    bibliography: list[dict]


@dataclass
class AgentConfig:
    model: str                 # LLM model to use
    temperature: float         # Default 0.2 for analytical tasks
    max_tokens: int
    effort: str                # "triage" or "audit"
```

**Agent Output:**

```python
@dataclass
class AgentOutput:
    # Structural summary
    summary: str               # Overall summary of the analyzed section
    
    # Chunks: logical groupings of blocks
    chunks: list[AnnotatedChunk]
    
    # Overall confidence (how confident the agent is in its analysis)
    overall_confidence: float  # 0.0–1.0
    
    # Raw metadata for debugging
    model_used: str
    input_tokens: int
    output_tokens: int


@dataclass
class AnnotatedChunk:
    chunk_id: str              # e.g. "chunk_1"
    source_ids: list[str]      # Block IDs this chunk covers: ["p3", "p4"]
    summary: str               # What this chunk does logically
    
    flags: list[Flag]
    confidence: float          # Per-chunk confidence
    
    # Optional: expanded argument (fills logical leaps)
    expanded_argument: str     # Detailed version with all steps explicit


@dataclass
class Flag:
    anchor: str                # Block or sentence ID: "p3" or "p3.s2"
    severity: str              # "info", "warning", "error"
    flag_type: str             # "gap", "error", "handwave", "unclear", "assumption"
    message: str               # Human-readable explanation
    confidence: float          # How confident the agent is in this flag
```

### 5.2 GlobalAnnotator (MVP Agent)

The GlobalAnnotator is the single agent in MVP. It takes the full document (1–2 pages), analyzes it in one pass, and returns the complete annotation set.

**Behavior:**

1. Receive the full document as a list of `FragmentBlock`s with context
2. Chunk the argument into logical units (may group multiple blocks into one chunk)
3. For each chunk:
   - Summarize what it accomplishes
   - Identify flags: gaps, errors, handwaving, unclear points, unverified assumptions
   - Assign severity and confidence per flag
   - Generate an "expanded argument" that fills logical leaps
4. Produce an overall summary and confidence indicator

**Prompt structure** (simplified):

```
You are a mathematical proof reviewer. Analyze the following mathematical
argument and produce a structured review.

NOTATION:
{context.notation formatted as a list}

REFERENCED RESULTS:
{context.theorem_index + definition_index formatted}

DOCUMENT:
{fragments formatted with block IDs as markers}

Produce a JSON response with the following structure:
{output schema}

Guidelines:
- Chunk the argument into logical steps (not necessarily one per paragraph)
- Flag genuine issues, not stylistic preferences
- "Handwave" flags are for steps claimed to be obvious/trivial that aren't
- "Gap" flags are for missing logical steps that a reader must fill
- "Error" flags are for statements that appear incorrect
- Confidence reflects how sure you are about each flag (not the proof's correctness)
- The expanded_argument should make every logical step explicit
- The summary should help a reader understand the proof's structure
```

**Model selection:** The agent is configured with a model parameter. Default for Triage: `claude-sonnet-4-6`. Users can override to use more capable models (e.g., `claude-opus-4-6`) at higher cost.

**Output parsing:** The agent returns structured JSON. The backend parses it, creates `Annotation` objects for each flag, and stores the raw output in `AgentRun.raw_output` for debugging.

### 5.3 Context Slice Construction

Before calling any agent, the backend builds a `ContextSlice` by processing the document's stored structure:

1. **Notation table**: Directly from `Document.macro_table`. Format each macro as a human-readable line: `\mcG → \mathcal{G} (calligraphic G)`.
2. **Theorem/definition index**: From `Document.structure.theorem_index` and `definition_index`. For each, include the ID, type, and a short statement.
3. **Section path**: Walk the block hierarchy to determine which section the requested fragment lives in.

For the GlobalAnnotator (which gets the full document), the context slice includes all definitions and theorems. For future agents that work on fragments, only relevant entries are included — "relevant" meaning: explicitly referenced via `\ref`/`\label`, or defined in a preceding section.

---

## 6. API Endpoints

All endpoints are prefixed with `/api/v1/`. Request/response bodies are JSON.

### 6.1 Documents

**`POST /api/v1/documents/`** — Upload and ingest a document.

```
Request:
{
    "source": "<LaTeX or Markdown+LaTeX content>",
    "source_format": "markdown" | "latex",
    "title": "Optional title",
    "preset": "manual" | "triage"
}

Response (201):
{
    "id": "uuid",
    "title": "...",
    "source_format": "markdown",
    "preset": "triage",
    "agent_status": "idle" | "running",  // "running" if preset=triage
    "block_count": 15,
    "created_at": "2026-04-04T12:00:00Z"
}
```

If `preset` is `triage`, the backend immediately kicks off the GlobalAnnotator agent asynchronously after ingestion completes.

**`GET /api/v1/documents/`** — List all documents.

**`GET /api/v1/documents/{id}/`** — Retrieve document metadata + structure.

**`GET /api/v1/documents/{id}/blocks/`** — Retrieve all blocks for a document.

```
Response (200):
{
    "blocks": [
        {
            "id": "p1",
            "block_type": "paragraph",
            "content_original": "We consider finite graphs $G = (V, E)$ ...",
            "content_expanded": "We consider finite graphs $G = (V, E)$ ...",
            "order": 0,
            "parent_id": "sec1",
            "sentences": [
                {"id": "p1.s1", "text": "We consider finite graphs $G = (V, E)$."},
                {"id": "p1.s2", "text": "A graph is admissible if ..."}
            ],
            "label": ""
        },
        {
            "id": "thm1",
            "block_type": "theorem",
            "content_original": "Every admissible graph $\\mcG$ satisfies ...",
            "content_expanded": "Every admissible graph $\\mathcal{G}$ satisfies ...",
            "order": 3,
            "parent_id": "sec2",
            "sentences": [...],
            "label": "thm:main"
        }
    ]
}
```

**`GET /api/v1/documents/{id}/source/`** — Retrieve original source text.

**`DELETE /api/v1/documents/{id}/`** — Delete a document and all associated data.

### 6.2 Annotations

**`GET /api/v1/documents/{id}/annotations/`** — List all annotations for a document.

Query parameters:
- `?source=human` or `?source=agent` — filter by source
- `?severity=warning,error` — filter by severity
- `?block_id=p3` — filter by block

```
Response (200):
{
    "annotations": [
        {
            "id": "uuid",
            "block_id": "p3",
            "sentence_id": "p3.s2",
            "source": "agent",
            "annotation_type": "gap",
            "severity": "warning",
            "message": "Finiteness assumption used but not justified.",
            "expanded_argument": "",
            "confidence": 0.75,
            "resolved": false,
            "created_at": "..."
        }
    ]
}
```

**`POST /api/v1/documents/{id}/annotations/`** — Create a human annotation.

```
Request:
{
    "block_id": "p5",
    "sentence_id": "p5.s1",        // optional
    "annotation_type": "comment",
    "severity": "info",
    "message": "I think this step also needs the compactness lemma."
}
```

**`PATCH /api/v1/documents/{id}/annotations/{ann_id}/`** — Update (e.g., mark as resolved).

**`DELETE /api/v1/documents/{id}/annotations/{ann_id}/`** — Delete a human annotation.

### 6.3 Agents

**`POST /api/v1/documents/{id}/agents/run/`** — Trigger an agent run.

```
Request:
{
    "agent_type": "global_annotator",
    "config": {
        "model": "claude-sonnet-4-6",    // optional override
        "temperature": 0.2               // optional override
    }
}

Response (202):
{
    "run_id": "uuid",
    "agent_type": "global_annotator",
    "status": "pending"
}
```

The agent runs asynchronously. The frontend polls for status or uses WebSocket (post-MVP).

**`GET /api/v1/documents/{id}/agents/runs/`** — List all agent runs for a document.

**`GET /api/v1/documents/{id}/agents/runs/{run_id}/`** — Get status and results of a specific run.

```
Response (200):
{
    "run_id": "uuid",
    "agent_type": "global_annotator",
    "status": "completed",
    "summary": "The argument proves that every admissible graph has...",
    "chunks": [...],
    "overall_confidence": 0.7,
    "input_tokens": 2500,
    "output_tokens": 1800,
    "started_at": "...",
    "completed_at": "..."
}
```

### 6.4 Chat

**`GET /api/v1/documents/{id}/chat/`** — Get chat history for a document.

**`POST /api/v1/documents/{id}/chat/`** — Send a chat message and get a response.

```
Request:
{
    "content": "Can you explain why the induction hypothesis applies here?",
    "selected_block_id": "p5",      // optional: what was selected
    "selected_text": "by the induction hypothesis"  // optional
}

Response (200):  // streamed via SSE for real-time output
{
    "id": "uuid",
    "role": "assistant",
    "content": "The induction hypothesis applies here because ...",
    "model": "claude-sonnet-4-6",
    "input_tokens": 1200,
    "output_tokens": 450
}
```

The chat endpoint constructs a system prompt that includes document context (structure, nearby blocks, annotations) so the LLM can give informed answers. The full chat history for this document is included as conversation context.

**System prompt for chat** (simplified):

```
You are a mathematical assistant helping review a proof. The user is
reading the following document:

DOCUMENT TITLE: {title}
DOCUMENT STRUCTURE: {structure summary}

CURRENT SECTION (around user's selection):
{blocks near the selected text, with IDs}

EXISTING ANNOTATIONS:
{relevant flags and comments near the selection}

The user has selected the following text:
> {selected_text} (from block {selected_block_id})

Help the user understand, verify, or explore this part of the argument.
Refer to specific parts of the document by their IDs when relevant.
```

### 6.5 Summary

**`GET /api/v1/documents/{id}/summary/`** — Get the structural summary.

Returns the chunk summaries from the most recent completed GlobalAnnotator run, formatted for the sidebar.

```
Response (200):
{
    "summary": "This paper proves that every admissible graph...",
    "chunks": [
        {
            "chunk_id": "chunk_1",
            "source_ids": ["p1", "p2", "def1"],
            "summary": "Defines admissible graphs and states main theorem.",
            "flags_count": {"info": 0, "warning": 1, "error": 0}
        },
        {
            "chunk_id": "chunk_2",
            "source_ids": ["p3", "p4", "lem1", "pf1"],
            "summary": "Proves the deletion lemma for admissible graphs.",
            "flags_count": {"info": 1, "warning": 0, "error": 0}
        }
    ],
    "overall_confidence": 0.7,
    "agent_run_id": "uuid"
}
```

---

## 7. Frontend

### 7.1 Layout

The MVP interface has three panels in a responsive layout:

```
┌─────────────────────────────────────────────────────────────────┐
│  ProofLint                              [Upload] [Preset: ▾]   │
├──────────┬──────────────────────────────────┬───────────────────┤
│          │                                  │                   │
│ Summary  │       Document Reader            │  Annotation Panel │
│ Sidebar  │                                  │  / Chatbot        │
│          │   [Color-coded paragraphs with   │                   │
│ chunk_1  │    inline math rendered via       │  Flags list       │
│ chunk_2  │    MathJax 3]                    │  (filterable)     │
│ chunk_3  │                                  │                   │
│  ...     │   Click paragraph → highlight    │  ── or ──         │
│          │   Click flag icon → show detail  │                   │
│ Confidence│                                  │  Chat interface   │
│ summary  │                                  │  (with selection  │
│          │                                  │   shortcuts)      │
│          │                                  │                   │
├──────────┴──────────────────────────────────┴───────────────────┤
│  Status bar: agent status, token usage                          │
└─────────────────────────────────────────────────────────────────┘
```

**Panel widths**: Summary sidebar ~200px, document reader ~flex, annotation/chat panel ~350px. All resizable.

### 7.2 Document Reader

The central panel renders the document with:

- **MathJax 3** for inline and display math
- **Block-level elements** as distinct DOM nodes with `data-block-id` attributes
- **Sentence-level spans** within paragraphs with `data-sentence-id` attributes
- **Color-coded backgrounds** based on annotation severity:
  - No annotations: no background
  - Info only: faint blue left border
  - Warning: light yellow background
  - Error: light red background
- **Flag indicators**: Small icons in the left margin at flagged locations. Click to scroll the annotation panel to the relevant flag.
- **Theorem/proof environments** rendered with standard mathematical styling (bold "Theorem 1.", italic body, etc.)
- **"Expand argument" button** on chunks that have an `expanded_argument`: clicking it shows the AI's detailed version inline, diff-style (post-MVP: actual diff view; MVP: expandable section below the original).
- **Text selection**: Users can select text, which enables:
  - A floating toolbar: "Annotate", "Ask about this", "Explain"
  - "Annotate" opens a form in the annotation panel
  - "Ask about this" / "Explain" switches to the chat panel with the selection as context

**Click-to-select**: Clicking a paragraph highlights it and scrolls the annotation panel to show its annotations. The summary sidebar highlights the corresponding chunk.

### 7.3 Summary Sidebar

Left panel showing the structural overview:

- **Document title** at top
- **Chunk list**: Each chunk is a card showing:
  - Chunk summary (1–2 lines)
  - Badge with flag counts by severity
  - Click to scroll the document reader to that section
- **Confidence summary** at the bottom: "3 warnings, 1 potential gap — moderate confidence" (language deliberately hedged, never a verdict)

The sidebar only populates after a GlobalAnnotator run completes. In Manual mode with no agent run, it shows: "Run Triage analysis to generate a structural summary."

### 7.4 Annotation Panel

Right panel (default view) showing all flags and comments:

- **Tabs or filter**: "All", "AI Flags", "My Annotations"
- **Severity filter**: Toggle info/warning/error visibility
- **Flag cards**: Each shows:
  - Severity icon + color
  - Anchor reference (clickable → scrolls document reader)
  - Type label ("Gap", "Handwave", etc.)
  - Message text
  - Confidence indicator (for AI flags)
  - "Resolve" checkbox
- **Human annotation form**: When user selects "Annotate" from the floating toolbar, a form appears here:
  - Type selector (Comment, Checked, Needs Review, Logic Mistake)
  - Severity selector
  - Free text input
  - Save / Cancel

### 7.5 Chat Panel

Right panel (toggled from annotation view, or switched via tab):

- **Chat history**: Messages displayed with role indicators
- **Input area**: Text input at the bottom with send button
- **Context indicator**: If text is selected in the document, shown above the input as "Asking about: [selected text] in block p5"
- **Quick actions**: When text is selected, buttons appear: "Explain this", "Check this step", "Look up definition of [symbol]"
- **Streaming**: Responses stream in via Server-Sent Events (SSE)

### 7.6 Upload Flow

1. User clicks "Upload" → modal with:
   - Text area for paste, or file upload button (.tex, .md)
   - Format auto-detection (fallback: manual toggle)
   - Title field (optional, auto-extracted from `\title{}` if present)
   - Preset selector (Manual / Triage)
2. Submit → backend ingests → redirect to document view
3. If Triage preset: agent status shown in status bar, annotations appear when ready

### 7.7 Zustand Stores

```typescript
// stores/documentStore.ts
interface DocumentStore {
    document: Document | null
    blocks: Block[]
    loading: boolean
    
    fetchDocument: (id: string) => Promise<void>
    fetchBlocks: (id: string) => Promise<void>
}

// stores/annotationStore.ts
interface AnnotationStore {
    annotations: Annotation[]
    filters: { source: string[], severity: string[] }
    
    fetchAnnotations: (docId: string) => Promise<void>
    createAnnotation: (docId: string, data: CreateAnnotation) => Promise<void>
    updateAnnotation: (docId: string, annId: string, data: Partial<Annotation>) => Promise<void>
    deleteAnnotation: (docId: string, annId: string) => Promise<void>
    setFilters: (filters: Partial<AnnotationStore['filters']>) => void
}

// stores/chatStore.ts
interface ChatStore {
    messages: ChatMessage[]
    selectedText: string
    selectedBlockId: string
    streaming: boolean
    
    fetchHistory: (docId: string) => Promise<void>
    sendMessage: (docId: string, content: string) => Promise<void>
    setSelection: (blockId: string, text: string) => void
}

// stores/uiStore.ts
interface UIStore {
    rightPanel: 'annotations' | 'chat'
    activeBlockId: string | null
    activeChunkId: string | null
    
    setRightPanel: (panel: 'annotations' | 'chat') => void
    setActiveBlock: (blockId: string | null) => void
    setActiveChunk: (chunkId: string | null) => void
}
```

---

## 8. Infrastructure

### 8.1 Docker Compose

The development environment is defined in a single `docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: prooflint
      POSTGRES_USER: prooflint
      POSTGRES_PASSWORD: prooflint_dev
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  backend:
    build: ./backend
    command: python manage.py runserver 0.0.0.0:8000
    ports:
      - "8000:8000"
    volumes:
      - ./backend:/app
    environment:
      - DATABASE_URL=postgres://prooflint:prooflint_dev@db:5432/prooflint
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    depends_on:
      - db

  frontend:
    build: ./frontend
    command: npm run dev -- --host 0.0.0.0
    ports:
      - "5173:5173"
    volumes:
      - ./frontend:/app
      - /app/node_modules

volumes:
  pgdata:
```

**Optional TeX service** (for TikZ rendering):

```yaml
  tex:
    image: texlive/texlive:latest  # or a slimmer custom image
    volumes:
      - ./backend/media:/media
    # Used by backend to compile TikZ → SVG on demand
```

### 8.2 Backend Dockerfile

```dockerfile
FROM python:3.12-slim

RUN apt-get update && apt-get install -y pandoc && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml ./
RUN pip install -e .
COPY . .

EXPOSE 8000
```

Pandoc is installed in the backend container. It's a single binary, ~100 MB.

### 8.3 Environment Variables

`.env.example`:

```
# Required
ANTHROPIC_API_KEY=sk-ant-...
DJANGO_SECRET_KEY=change-me-in-production

# Optional
OPENAI_API_KEY=sk-...
DATABASE_URL=postgres://prooflint:prooflint_dev@localhost:5432/prooflint
DEBUG=true
ALLOWED_HOSTS=localhost,127.0.0.1

# Agent defaults
DEFAULT_MODEL=claude-sonnet-4-6
DEFAULT_TEMPERATURE=0.2
```

### 8.4 User Setup (End Users)

The target UX: clone the repo, run one script, then everything else happens in the browser.

**Prerequisites:** Python 3.11+ installed. Nothing else.

```bash
git clone https://github.com/<org>/prooflint.git
cd prooflint
./install.sh        # or: python install.py (for Windows compatibility)
# → Opens browser at http://localhost:8000
```

**What `install.sh` does:**
1. Creates a Python virtual environment
2. Installs backend dependencies (including Pandoc via `pypandoc` which bundles it)
3. Installs frontend dependencies (`npm install`, assumes Node.js or installs via `nodeenv`)
4. Runs database migrations (SQLite for end-user mode — see note below)
5. Builds the frontend (`npm run build`, served by Django in production mode)
6. Generates a random `DJANGO_SECRET_KEY`
7. Starts the server and opens the browser

**First-run setup wizard (in browser):** On first visit, if no API keys are configured, the app shows a setup page:
- Enter Anthropic API key (required for agents + chat)
- Enter OpenAI API key (optional, for model choice)
- Choose default model
- Keys are stored in a local `.env` file (never committed) via a backend endpoint

**Note on SQLite vs PostgreSQL:** End users get SQLite by default (zero setup). The install script does not require Docker or Postgres. PostgreSQL is used for the Docker-based contributor/development setup (see below) where concurrent agent writes benefit from proper connection handling.

### 8.4.1 Contributor Setup (Docker)

For development with hot-reloading and PostgreSQL:

```bash
git clone https://github.com/<org>/prooflint.git
cd prooflint
cp .env.example .env
# Edit .env to add API keys (or configure later via browser)
docker compose up
# → Backend at http://localhost:8000 (hot-reload)
# → Frontend at http://localhost:5173 (Vite dev server, hot-reload)
```

For development without Docker:

```bash
# Backend
cd backend
pip install -e ".[dev]"
python manage.py migrate
python manage.py runserver

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

### 8.5 Python Dependencies

```toml
# backend/pyproject.toml
[project]
name = "prooflint-backend"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "django>=5.0",
    "djangorestframework>=3.15",
    "django-cors-headers>=4.0",
    "psycopg[binary]>=3.1",
    "dj-database-url>=2.0",
    "panflute>=2.3",
    "httpx>=0.27",
    "anthropic>=0.40",
    "python-dotenv>=1.0",
]

[project.optional-dependencies]
dev = [
    "ruff>=0.5",
    "pytest>=8.0",
    "pytest-django>=4.8",
]
```

### 8.6 Frontend Dependencies

```json
{
    "dependencies": {
        "react": "^18.3",
        "react-dom": "^18.3",
        "zustand": "^5.0",
        "mathjax-full": "^3.2",
        "better-react-mathjax": "^2.0",
        "axios": "^1.7"
    },
    "devDependencies": {
        "typescript": "^5.5",
        "vite": "^6.0",
        "@vitejs/plugin-react": "^4.3",
        "eslint": "^9.0",
        "prettier": "^3.3",
        "@types/react": "^18.3",
        "@types/react-dom": "^18.3"
    }
}
```

---

## 9. Async Agent Execution

Agents (especially the GlobalAnnotator) can take 10–30 seconds. The MVP uses a simple async pattern:

### 9.1 Execution Flow

1. `POST /api/v1/documents/{id}/agents/run/` creates an `AgentRun` with status `pending`
2. Backend launches the agent in a background thread (Django's `threading.Thread` for MVP; migrate to Celery/task queue for production)
3. The thread:
   - Updates status to `running`
   - Builds the `AgentInput` (context slice, fragments)
   - Calls the LLM API
   - Parses the response into `AgentOutput`
   - Creates `Annotation` objects for each flag
   - Updates status to `completed` (or `failed`)
4. Frontend polls `GET /agents/runs/{run_id}/` every 2 seconds while status is `pending` or `running`

### 9.2 Post-MVP: WebSocket

Replace polling with a WebSocket connection per document session. The backend pushes:
- Agent status changes
- New annotations as they're created
- Chat message streaming

This is explicitly out of MVP scope — polling works fine for a single-user local tool.

---

## 10. Implementation Roadmap

### Phase 1: Skeleton (Week 1)
- [ ] Create GitHub repo with project structure
- [ ] Django project + apps scaffolding (documents, annotations, agents)
- [ ] React + Vite + TypeScript scaffolding
- [ ] Docker Compose with Postgres
- [ ] Data models + migrations
- [ ] Basic REST endpoints (CRUD for documents)
- [ ] Simple frontend: upload form, document list

### Phase 2: Ingestion Pipeline (Week 2)
- [ ] Pandoc integration: LaTeX/Markdown → AST
- [ ] Panflute filter: AST → blocks with IDs
- [ ] Macro extraction and expansion
- [ ] Sentence splitting (math-aware)
- [ ] Store blocks in DB
- [ ] API: blocks endpoint
- [ ] Frontend: render blocks with MathJax 3

### Phase 3: Document Reader UI (Week 3)
- [ ] Block-level rendering with data attributes
- [ ] Color-coded backgrounds based on annotations
- [ ] Click-to-select paragraphs
- [ ] Text selection → floating toolbar
- [ ] Summary sidebar (static structure for now)
- [ ] Responsive three-panel layout

### Phase 4: GlobalAnnotator Agent (Week 4)
- [ ] Agent contract implementation (input/output dataclasses)
- [ ] Context slice builder
- [ ] GlobalAnnotator prompt + LLM call
- [ ] Output parsing → Annotation objects
- [ ] AgentRun tracking + async execution
- [ ] Polling from frontend
- [ ] Annotation panel: display AI flags
- [ ] Summary sidebar: populated from agent output
- [ ] "Expand argument" inline sections

### Phase 5: Human Annotations + Chat (Week 5)
- [ ] Human annotation creation/editing/deletion
- [ ] Annotation panel: filter by source/severity
- [ ] Resolve/unresolve annotations
- [ ] Chat backend: message storage + LLM relay
- [ ] Chat system prompt with document context
- [ ] Chat frontend: message list + input
- [ ] SSE streaming for chat responses
- [ ] Selection → chat context integration

### Phase 6: Polish + Testing (Week 6)
- [ ] Error handling throughout
- [ ] Loading states and skeleton UI
- [ ] Keyboard shortcuts (next/prev flag, toggle panels)
- [ ] Test suite: backend API tests, ingestion pipeline tests
- [ ] Browser testing setup (Playwright — workflow experiment)
- [ ] README, CONTRIBUTING.md, setup documentation
- [ ] Test with real mathematical documents

---

## 11. Open Questions

### Resolved

1. ~~**Sentence splitting quality**~~: **Decision: implement sentence-level IDs from the start.** The rule-based math-aware splitter will make mistakes on complex prose, but having the infrastructure in place is more important than perfection. We can improve the splitter iteratively. Agents and the UI will support both block-level and sentence-level anchoring from day one.

5. ~~**Authentication**~~: **Decision: no auth for MVP.** The tool runs locally. API keys are configured via a browser-based setup wizard on first run, stored in a local `.env` file. No login, no user accounts. DRF makes it easy to add later for a hosted version.

### Open

2. **Chat model**: Same model as the GlobalAnnotator, or always use the most capable available? Chat benefits from stronger reasoning (explaining complex steps), but cost adds up with long conversations. Suggestion: user-configurable per document, defaulting to the same model as the agent preset.

3. **Agent output validation**: When the LLM returns JSON that doesn't match the schema (missing fields, wrong types), do we: (a) fail the run, (b) best-effort parse with defaults, (c) retry once? Suggestion: (b) for MVP with clear UI indication of partial results.

4. **Multi-document**: The data model supports multiple documents. Should the MVP UI have a document list/dashboard, or just a single-document view with upload? Suggestion: minimal dashboard (list + upload button) to avoid losing documents.

6. **Verdict language alignment**: The v1 vision doc says "overall validity assessment." The MVP spec says "No verdicts, only evidence." The MVP spec stance is better for expert users — should we update the v1 doc to align? Suggestion: yes, update v1 to say "confidence summary" / "review summary with confidence indicators" instead.

---

## Appendix A: Example Document Flow

**Input** (Markdown+LaTeX from an AI model):

```markdown
## Main Result

**Theorem 1.** Every finite graph $G$ with $\Delta(G) \leq 3$ is 4-colorable.

*Proof.* We proceed by induction on $n = |V(G)|$.

**Base case.** If $n \leq 4$, the result is immediate since we have at most 4 vertices.

**Inductive step.** Assume the result holds for all graphs with fewer than $n$ vertices.
Let $v$ be a vertex of $G$ with $\deg(v) \leq 3$. By the induction hypothesis,
$G - v$ is 4-colorable. Since $v$ has at most 3 neighbors, at most 3 colors are
used on $N(v)$, so a fourth color is available for $v$.  $\square$
```

**After ingestion, blocks:**

| ID | Type | Content (truncated) |
|---|---|---|
| `sec1` | section_heading | "Main Result" |
| `thm1` | theorem | "Every finite graph $G$ with..." |
| `pf1` | proof | (contains sub-blocks) |
| `pf1.p1` | paragraph | "We proceed by induction on $n = \|V(G)\|$." |
| `pf1.p2` | paragraph | "**Base case.** If $n \leq 4$, ..." |
| `pf1.p3` | paragraph | "**Inductive step.** Assume the result holds..." |

**GlobalAnnotator output** (abbreviated):

```json
{
    "summary": "Proves 4-colorability for graphs with max degree 3 via induction on vertex count.",
    "chunks": [
        {
            "chunk_id": "chunk_1",
            "source_ids": ["thm1"],
            "summary": "States the main theorem: Δ(G) ≤ 3 implies 4-colorable.",
            "flags": [],
            "confidence": 0.95
        },
        {
            "chunk_id": "chunk_2",
            "source_ids": ["pf1.p1", "pf1.p2"],
            "summary": "Sets up induction and handles the base case.",
            "flags": [
                {
                    "anchor": "pf1.p2",
                    "severity": "info",
                    "type": "handwave",
                    "message": "'The result is immediate' — correct but could note that any graph on ≤4 vertices trivially has a proper 4-coloring by assigning distinct colors.",
                    "confidence": 0.6
                }
            ],
            "confidence": 0.9
        },
        {
            "chunk_id": "chunk_3",
            "source_ids": ["pf1.p3"],
            "summary": "Inductive step: remove a low-degree vertex, color the rest, extend.",
            "flags": [
                {
                    "anchor": "pf1.p3",
                    "severity": "warning",
                    "type": "gap",
                    "message": "The existence of a vertex with deg(v) ≤ 3 follows from Δ(G) ≤ 3, but the argument implicitly uses that Δ(G-v) ≤ 3 still holds (which is true since deleting a vertex cannot increase degrees). This should be stated.",
                    "confidence": 0.8
                }
            ],
            "confidence": 0.75,
            "expanded_argument": "Let v be any vertex of G. Since Δ(G) ≤ 3, we have deg(v) ≤ 3. Consider G' = G - v. For any vertex u in G', deg_{G'}(u) ≤ deg_G(u) ≤ 3, so Δ(G') ≤ 3. Since |V(G')| = n-1, the induction hypothesis gives a proper 4-coloring c of G'. Now v has at most 3 neighbors in G, so at most 3 colors from {1,2,3,4} appear on N(v). Thus at least one color is available; assign it to v. This extends c to a proper 4-coloring of G."
        }
    ],
    "overall_confidence": 0.8
}
```

**What the user sees:** The document rendered with the base case paragraph having a faint blue left border (info) and the inductive step paragraph having a light yellow background (warning). The summary sidebar shows the three chunks. The annotation panel lists the two flags. Clicking the warning flag scrolls to the inductive step and highlights it. Clicking "Expand argument" below the inductive step shows the detailed version.
