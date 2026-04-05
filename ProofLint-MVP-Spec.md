# ProofLint — MVP Technical Specification

**Version**: 0.3 (Revised — annotation model v2, Bot naming, expanded argument design)
**Date**: 2026-04-05
**Status**: Phases 1–3 complete, Phase 4 in progress

---

## 1. Product Summary

ProofLint is a browser-based tool that ingests mathematical writing (LaTeX or Markdown+LaTeX), renders it in a standardized format with stable structural IDs, and overlays AI-generated annotations to help a human expert review proofs. The MVP targets 1–2 page mathematical arguments and delivers: document ingestion/rendering, a single GlobalAnnotatorBot pass, human annotations, a chatbot sidebar, and a structural summary panel.

### 1.1 Design Principles

- **Human-in-the-loop**: AI flags and explains; the human decides. No verdicts, only evidence.
- **Grounding first**: Every annotation is anchored to a stable document ID. Deterministic mapping from agent output to rendered position — no fuzzy matching.
- **Modular bots**: Each annotation type is produced by a pluggable bot (GlobalAnnotatorBot, LiteratureBot, LeanBot, etc.) conforming to a standard contract. The system is designed so new bots can be added without modifying core infrastructure.
- **Contributor-friendly**: Clear separation of concerns, typed interfaces, standard tooling, Docker-based dev environment.

### 1.2 Effort Presets

| Preset | What runs | Use case |
|---|---|---|
| **Manual** | Ingest + render only; tools invoked manually on demand | Interactive workbench |
| **Triage** | + GlobalAnnotatorBot: summary, one-pass vetting with flags, confidence summary | Quick review: "what should I pay attention to?" |
| **Audit** | + Full paragraph-by-paragraph vetting (post-MVP bots) | Deep review |

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
│  │ - Upload    │  │ - Human flags  │  │ - Bot orchestration  │  │
│  │ - Ingest    │  │ - AI flags     │  │ - GlobalAnnotatorBot      │  │
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
| LLM access | openai SDK (Responses API) / anthropic SDK | Bot calls, chat relay |
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

Both human annotations and AI-generated annotations live in the same model, distinguished by `source`. The annotation schema follows the **Annotation Model Specification v2** (`notes/annotation-model-spec-v2.md`), which is the authoritative reference for categories, tags, severity levels, and lifecycle semantics.

```python
class Annotation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    document = models.ForeignKey(Document, related_name="annotations", on_delete=models.CASCADE)
    
    # Anchor — contiguous span of blocks (string IDs, not FKs, to survive re-ingestion)
    start_block = models.CharField(max_length=50)   # First block touched (e.g. "p3")
    end_block = models.CharField(max_length=50)      # Last block touched (== start_block for single-block)
    start_offset = models.PositiveIntegerField(default=0)   # Character offset in start_block (0 = block start)
    end_offset = models.PositiveIntegerField(null=True, blank=True)  # Character offset in end_block (null = end of block)
    anchor_quote = models.TextField(blank=True)      # Verbatim quote for recovery after re-ingestion
    
    # Content
    category = models.CharField(max_length=10, choices=[
        ("check", "Check"),   # Records that something has been verified
        ("info", "Info"),     # Adds context without claiming a problem
        ("issue", "Issue"),   # Flags a potential or confirmed problem
    ])
    tags = models.JSONField(default=list)  # Zero or more canonical slugs (see annotation-model-spec-v2)
    severity = models.CharField(max_length=10, choices=[
        ("question", "Question"),  # Not sure; flagging for attention
        ("warning", "Warning"),    # Something off, likely fixable
        ("error", "Error"),        # Serious problem
    ], blank=True)  # Required when category = issue; blank for check/info
    body = models.TextField(blank=True)  # Freetext comment / explanation
    metadata = models.JSONField(default=dict)  # Flexible key-value store (agent-specific data)
    
    # Provenance
    source = models.CharField(max_length=20, choices=[
        ("human", "Human"),
        ("agent", "AI Agent"),
    ])
    author = models.CharField(max_length=200, default="Human")  # "Human" for MVP; bot name for agent annotations
    agent_run = models.ForeignKey(
        "agents.AgentRun", null=True, blank=True,
        related_name="annotations", on_delete=models.SET_NULL
    )
    chunk = models.ForeignKey(
        "agents.Chunk", null=True, blank=True,
        related_name="annotations", on_delete=models.SET_NULL
    )
    confidence = models.FloatField(null=True, blank=True)  # 0.0–1.0 (agent annotations)
    
    # Lifecycle (semantics are category-dependent — see annotation-model-spec-v2 §2.3)
    resolved = models.BooleanField(default=False)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.CharField(max_length=200, blank=True)
    
    # Linked annotations (symmetric, untyped M2M)
    related_annotations = models.ManyToManyField("self", blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ["start_block", "created_at"]
```

**Category and tag overview** (see `notes/annotation-model-spec-v2.md` for full definitions):

| Category | Example tags | Severity |
|---|---|---|
| `check` | `manual_review`, `agent_review`, `formalization`, `experiment`, `example_check`, `cross_reference` | n/a |
| `info` | `summary`, `reference`, `remark`, `expanded_argument` | n/a |
| `issue` | `typo`, `gap`, `handwaving`, `incomplete_argument`, `assumption_mismatch`, `calculation_error`, `notation_conflict`, `false_citation` | `question` / `warning` / `error` |

The `expanded_argument` info tag is used by bots to attach a detailed, step-by-step rewriting of a proof chunk. These annotations have special display behavior (see §7.2).

### 4.4 Chunk

Persists the logical chunks produced by a bot run. Chunks group blocks into logical steps and carry the bot's structural analysis (summary, confidence). Annotations (including `expanded_argument` info annotations) link back to their parent chunk via a foreign key.

```python
class Chunk(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    agent_run = models.ForeignKey("agents.AgentRun", related_name="chunks", on_delete=models.CASCADE)
    document = models.ForeignKey(Document, related_name="chunks", on_delete=models.CASCADE)
    
    # Identity
    chunk_id = models.CharField(max_length=50)  # e.g. "chunk_1" (local to the agent run)
    
    # Which blocks this chunk covers
    source_block_ids = models.JSONField()  # ["p3", "p4", "p5"]
    
    # Analysis
    summary = models.TextField()
    confidence = models.FloatField()  # 0.0–1.0
    # Note: expanded arguments are stored as info annotations (tag "expanded_argument")
    # linked to this chunk via the Annotation.chunk FK, not as a field on Chunk.
    
    # Ordering (within the agent run's output)
    order = models.PositiveIntegerField()
    
    class Meta:
        ordering = ["order"]
```

Expanded arguments are modeled as `info` annotations with the `expanded_argument` tag, linked to their parent chunk. Each chunk typically gets one such annotation, anchored to the chunk's block range. Display behavior is described in §7.2.

### 4.5 AgentRun

Tracks invocations of AI agents against a document.

```python
class AgentRun(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    document = models.ForeignKey(Document, related_name="agent_runs", on_delete=models.CASCADE)
    
    agent_type = models.CharField(max_length=50)  # e.g. "global_annotator_bot"
    status = models.CharField(max_length=20, choices=[
        ("pending", "Pending"),
        ("running", "Running"),
        ("completed", "Completed"),
        ("failed", "Failed"),
    ])
    
    # Configuration
    model = models.CharField(max_length=100)  # e.g. "gpt-5.4"
    preset = models.CharField(max_length=20)  # Which preset triggered this
    config = models.JSONField(default=dict)  # Bot config: reasoning_effort, steering_prompt, options
    
    # External API tracking
    openai_response_id = models.CharField(max_length=100, blank=True)  # For polling background responses
    
    # Results
    raw_output = models.JSONField(null=True, blank=True)  # Full bot response (BotOutput JSON)
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

## 5. Bot Contract

Bots are the pluggable AI agents in ProofLint. Each bot type follows a naming convention: `GlobalAnnotatorBot`, `LiteratureBot`, `LeanBot`, `ChunkBot`, etc. All bots conform to the same input/output contract so the system doesn't care how a bot produces its output, only that the shapes match.

### 5.1 Standard Bot Interface

**Bot Input:**

```python
@dataclass
class BotInput:
    # The document fragment to analyze (expanded macros)
    fragments: list[FragmentBlock]
    
    # Context built by the preprocessing pass
    context: ContextSlice
    
    # Bot configuration
    config: BotConfig


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
class BotConfig:
    model: str                 # LLM model to use (default: "gpt-5.4")
    reasoning_effort: str      # "low", "medium", "high", "xhigh" (default: "xhigh")
    preset: str                # "triage" or "audit"
    
    # Steering — user-provided instructions that shape the bot's focus
    steering_prompt: str       # e.g. "Focus on Lemma 1", "Ignore small typos"
    
    # Bot-specific options (varies by bot type)
    options: dict              # e.g. {"produce_checks": True}
    
    # Note: temperature is NOT configurable — it is rejected by the OpenAI
    # Responses API when reasoning_effort > "none". max_output_tokens is left
    # at the model default (128k for gpt-5.4) to avoid truncating reasoning.
```

**Bot Output:**

```python
@dataclass
class BotOutput:
    # Structural summary
    summary: str               # Overall summary of the analyzed section
    
    # Chunks: logical groupings of blocks
    chunks: list[AnnotatedChunk]
    
    # Annotations produced by this bot (v2 schema)
    annotations: list[BotAnnotation]
    
    # Overall confidence (how confident the bot is in its analysis)
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
    confidence: float          # Per-chunk confidence


@dataclass
class BotAnnotation:
    """Matches the Annotation v2 creation shape. The backend maps this
    directly to Annotation objects, filling in provenance fields
    (source='agent', author=bot_name, agent_run, chunk)."""
    
    # Anchor
    start_block: str           # e.g. "p3"
    end_block: str             # e.g. "p3" (same for single-block)
    
    # Content
    category: str              # "check", "info", or "issue"
    tags: list[str]            # e.g. ["gap"], ["expanded_argument"], ["agent_review"]
    severity: str              # "question", "warning", "error" (required for issues; empty otherwise)
    body: str                  # Human-readable explanation
    confidence: float          # How confident the bot is in this annotation
    
    # Grouping — which chunk this annotation belongs to
    chunk_id: str              # References AnnotatedChunk.chunk_id
```

### 5.2 GlobalAnnotatorBot (MVP Bot)

The GlobalAnnotatorBot is the first bot in MVP. It takes the full document (1–2 pages), analyzes it in one pass, and returns chunks, annotations, and optionally expanded arguments.

**Invocation UX:** The user invokes GlobalAnnotatorBot via a button or menu action. This opens a **wizard dialog** with:

- **Produce checks** toggle — whether the bot should mark blocks it considers sound (`check` / `agent_review`). Default: off.
- **Steering prompt** — optional free-text instructions (e.g. "Focus on Lemma 1", "Ignore small typos and presentation issues", "Pay special attention to the induction step").
- **Model selector** — which LLM model to use. Default: `gpt-5.4`.
- **Reasoning effort** — dropdown: low / medium / high / xhigh. Default: `xhigh`.
- **Run** button — starts the bot. The dialog closes and a persistent status indicator appears (see §9 for long-running call UX).

If the user has selected blocks before invoking the bot, the wizard pre-fills a scope restriction (analyze only the selected range). The full document context is still provided for reference.

**Behavior:**

1. Receive the full document as a list of `FragmentBlock`s with context
2. Chunk the argument into logical units (may group multiple blocks into one chunk)
3. For each chunk:
   - Summarize what it accomplishes
   - Produce `issue` annotations for problems found (using appropriate tags: `gap`, `handwaving`, `incomplete_argument`, `assumption_mismatch`, `calculation_error`, etc.)
   - Produce `info` / `remark` annotations for noteworthy observations
   - Produce `info` / `expanded_argument` annotations with a step-by-step rewriting of the chunk's logic (one per chunk, anchored to the chunk's block range)
   - If checks enabled: produce `check` / `agent_review` annotations for blocks the bot considers sound
4. Produce an overall summary and confidence indicator
5. Apply the steering prompt to adjust focus, depth, and which kinds of findings to suppress or emphasize

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

{steering_prompt, if provided}

Produce a JSON response with the following structure:
{BotOutput schema}

Guidelines:
- Chunk the argument into logical steps (not necessarily one per paragraph)
- For each issue, choose the most specific tag:
  - "gap": a genuinely missing step — a real hole in the logic
  - "handwaving": too vague to identify what concrete step is being skipped
  - "incomplete_argument": skipped steps that are plausibly fillable
  - "assumption_mismatch": a result applied in the wrong context
  - "calculation_error": sign error, forgotten term, wrong inequality direction
  - "typo": spelling, grammar, or obvious notational slip
- Severity reflects impact: "question" (unsure), "warning" (real but fixable), "error" (may invalidate argument)
- Confidence reflects how sure you are about each annotation (not the proof's correctness)
- For each chunk, produce an expanded_argument annotation that makes every logical step explicit
- The summary should help a reader understand the proof's structure
{if produce_checks: "- Mark blocks you consider sound with category 'check', tag 'agent_review'"}
```

**Model selection:** Configured via the wizard. Default: `gpt-5.4` with `reasoning_effort: "xhigh"`. This combination produces the highest-quality analysis but calls typically take **30–50 minutes** via the OpenAI Responses API in background mode. Users can lower reasoning effort for faster (but shallower) results. Alternative models (e.g., Claude Sonnet/Opus via Anthropic API) can be supported as a future extension.

**Structured output:** The bot prompt requests JSON via `text.format` with `type: "json_schema"` and `strict: true`, providing the `BotOutput` schema. This guarantees valid, schema-conforming JSON output from the model. No best-effort parsing or retry logic is needed for structural validity — only semantic validation (e.g., checking that referenced block IDs exist).

**Output parsing:** The backend validates and maps each `BotAnnotation` to an `Annotation` object (filling `source='agent'`, `author='GlobalAnnotatorBot'`, `agent_run`, `chunk` FK). The raw output is stored in `AgentRun.raw_output` for debugging.

**Prompting notes for reasoning models:**
- Do NOT include chain-of-thought instructions ("think step by step") — the model reasons internally via its reasoning tokens.
- Keep the prompt direct: state the goal, provide the document, specify the output schema.
- The steering prompt from the wizard is appended verbatim as a `USER INSTRUCTIONS` section.

### 5.3 Context Slice Construction

Before calling any agent, the backend builds a `ContextSlice` by processing the document's stored structure:

1. **Notation table**: Directly from `Document.macro_table`. Format each macro as a human-readable line: `\mcG → \mathcal{G} (calligraphic G)`.
2. **Theorem/definition index**: From `Document.structure.theorem_index` and `definition_index`. For each, include the ID, type, and a short statement.
3. **Section path**: Walk the block hierarchy to determine which section the requested fragment lives in.

For the GlobalAnnotatorBot (which gets the full document), the context slice includes all definitions and theorems. For future bots that work on fragments, only relevant entries are included — "relevant" meaning: explicitly referenced via `\ref`/`\label`, or defined in a preceding section.

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
- `?category=issue` or `?category=check,info` — filter by category
- `?severity=warning,error` — filter by severity (issues only)
- `?block_id=p3` — filter by block (matches annotations whose span contains this block, i.e. `start_block <= p3 <= end_block` in document order)

```
Response (200):
{
    "annotations": [
        {
            "id": "uuid",
            "start_block": "p3",
            "end_block": "p3",
            "start_offset": 0,
            "end_offset": 142,
            "anchor_quote": "",
            "category": "issue",
            "tags": ["gap"],
            "severity": "warning",
            "body": "Finiteness assumption used but not justified.",
            "metadata": {},
            "source": "agent",
            "author": "GlobalAnnotatorBot",
            "confidence": 0.75,
            "resolved": false,
            "related_annotations": [],
            "created_at": "..."
        }
    ]
}
```

**`POST /api/v1/documents/{id}/annotations/`** — Create a human annotation.

```
Request:
{
    "start_block": "p5",
    "end_block": "p5",
    "category": "issue",
    "tags": ["incomplete_argument"],
    "severity": "question",
    "body": "I think this step also needs the compactness lemma."
}
```

`end_block` defaults to `start_block` if omitted. `start_offset` defaults to `0`, `end_offset` defaults to the block's content length (i.e. full-block span). `author` defaults to `"Human"` (MVP has no user accounts; post-MVP this will come from the authenticated user profile).

**`PATCH /api/v1/documents/{id}/annotations/{ann_id}/`** — Update (e.g., mark as resolved, edit body).

**`DELETE /api/v1/documents/{id}/annotations/{ann_id}/`** — Delete a human annotation.

### 6.3 Bots

**`POST /api/v1/documents/{id}/agents/run/`** — Trigger a bot run.

```
Request:
{
    "agent_type": "global_annotator_bot",
    "config": {
        "model": "gpt-5.4",             // optional override (default from settings)
        "reasoning_effort": "xhigh",     // optional override
        "steering_prompt": "Focus on the induction step, ignore typos",
        "options": {
            "produce_checks": false
        }
    }
}

Response (202):
{
    "run_id": "uuid",
    "agent_type": "global_annotator_bot",
    "status": "pending"
}
```

The bot runs asynchronously. The frontend polls for status or uses WebSocket (post-MVP).

**`GET /api/v1/documents/{id}/agents/runs/`** — List all bot runs for a document.

**`GET /api/v1/documents/{id}/agents/runs/{run_id}/`** — Get status and results of a specific run.

```
Response (200):
{
    "run_id": "uuid",
    "agent_type": "global_annotator_bot",
    "status": "completed",
    "summary": "The argument proves that every admissible graph has...",
    "chunks": [...],
    "overall_confidence": 0.7,
    "annotation_count": 5,
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
    "model": "gpt-5.4",
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

Returns the chunk summaries from the most recent completed GlobalAnnotatorBot run, formatted for the sidebar.

```
Response (200):
{
    "summary": "This paper proves that every admissible graph...",
    "chunks": [
        {
            "chunk_id": "chunk_1",
            "source_ids": ["p1", "p2", "def1"],
            "summary": "Defines admissible graphs and states main theorem.",
            "annotation_counts": {"check": 0, "info": 1, "issue": 1}
        },
        {
            "chunk_id": "chunk_2",
            "source_ids": ["p3", "p4", "lem1", "pf1"],
            "summary": "Proves the deletion lemma for admissible graphs.",
            "annotation_counts": {"check": 0, "info": 2, "issue": 0}
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
- **Color-coded backgrounds** based on annotation category (see §7.8 Color Scheme):
  - No annotations: no background
  - Check only: green tint (darker for human, lighter for agent)
  - Info only: faint blue left border
  - Issue: yellow (question), orange (warning), or red (error)
  - When multiple categories are present, issue takes visual priority
- **Theorem/proof environments** rendered with standard mathematical styling (bold "Theorem 1.", italic body, etc.)
- **Expanded argument toggles**: Chunks that have an `expanded_argument` annotation show a small chevron (▸/▾). Clicking expands the bot's step-by-step rewriting below the chunk text. A global **View > Expanded Arguments** menu provides:
  - Show all expanded arguments
  - Hide all expanded arguments
  - Display mode: "Below text" (default) or "Annotation column" (shows as a regular info annotation)
- **Text selection**: Users can select text, which enables:
  - A floating toolbar: "Annotate", "Ask about this", "Explain"
  - "Annotate" opens a form in the annotation panel
  - "Ask about this" / "Explain" switches to the chat panel with the selection as context

**Click-to-select**: Clicking a block highlights it and scrolls the annotation panel to show its annotations. Shift-clicking extends to a multi-block range. The summary sidebar highlights the corresponding chunk.

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

Right panel (default view) showing annotations grouped by block position:

- **Category visibility toggles**: Check / Info / Issue — toggle which categories are shown
- **Source filter**: "All", "Bot", "Human"
- **Annotation cards**: Each shows:
  - Category icon + color (see §7.8)
  - Tag chips as small badges (display labels derived from slugs)
  - Severity badge (issues only: question/warning/error)
  - Author + timestamp
  - Body text (click to edit; supports Markdown + LaTeX rendering)
  - Confidence indicator (for bot annotations)
  - Action button: "Resolve" (issue) / "Revoke" (check) / "Archive" (info)
- **SVG connector lines**: S-curve dot connector for single-block annotations; bracket connector spanning blocks for multi-block annotations
- **Human annotation form**: When the user selects block(s) and clicks "Annotate", a form appears:
  - Category selector (Check / Info / Issue)
  - Tag checkboxes (filtered by selected category)
  - Severity selector (if Issue)
  - Free text body
  - Save / Cancel

Note: `expanded_argument` annotations are hidden from this panel by default (they display inline in the reader — see §7.2). The "Annotation column" display mode in View options moves them here.

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

### 7.7 Bot Wizard Dialog

When the user invokes a bot (via toolbar button or menu), a wizard dialog opens. The wizard is bot-specific but shares common structure:

1. **Header**: Bot name + short description
2. **Scope indicator**: If blocks are selected, shows "Analyzing blocks p3–p7" with an option to clear (→ full document)
3. **Bot-specific options**: Checkboxes/toggles (e.g. "Produce checks" for GlobalAnnotatorBot)
4. **Steering prompt**: Free-text field for user instructions
5. **Model selector**: Dropdown with available models (from Settings). Default: `gpt-5.4`
6. **Reasoning effort**: Dropdown (low / medium / high / xhigh). Default: `xhigh`. A note below: "xhigh typically takes 30–50 minutes"
7. **Run button**: Starts the bot, closes the wizard, shows persistent status indicator in the status bar (see §9.3)

### 7.8 Color Scheme

Colors are determined by annotation **category** (and severity for issues):

| Category | Condition      | Background / accent |
|----------|----------------|---------------------|
| check    | source=human   | Dark green (#e6f4ea) |
| check    | source=agent   | Light green (#f0faf0) |
| info     | Any            | Blue (#e8f0fe / border #5b9bd5) |
| issue    | question       | Yellow (#fff8e1) |
| issue    | warning        | Orange (#fff3e0) |
| issue    | error          | Red (#fff0f0) |

When a block has annotations from multiple categories, Issue takes visual priority over Check (unresolved problems should not be hidden behind green).

### 7.9 Zustand Stores

```typescript
// stores/documentStore.ts
interface DocumentStore {
    documents: Document[]
    currentDocument: Document | null
    blocks: Block[]
    loading: boolean
    error: string | null
    
    fetchDocuments: () => Promise<void>
    fetchDocument: (id: string) => Promise<void>
    fetchBlocks: (docId: string) => Promise<void>
    createDocument: (source: string, sourceFormat: string, title: string, preset: string) => Promise<void>
    deleteDocument: (id: string) => Promise<void>
}

// stores/annotationStore.ts
interface AnnotationStore {
    annotations: Annotation[]
    filters: { source: string[], severity: string[], category: string[] }
    
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
    activeBlockIds: string[]          // Supports multi-block selection
    anchorBlockId: string | null      // For shift-extend selection
    activeChunkId: string | null
    sidebarCollapsed: boolean
    
    setRightPanel: (panel: 'annotations' | 'chat') => void
    setActiveBlock: (blockId: string) => void
    setBlockRange: (fromId: string, toId: string, orderedIds: string[]) => void
    setActiveChunk: (chunkId: string | null) => void
    toggleSidebar: () => void
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
OPENAI_API_KEY=sk-...
DJANGO_SECRET_KEY=change-me-in-production

# Optional
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgres://prooflint:prooflint_dev@localhost:5432/prooflint
DEBUG=true
ALLOWED_HOSTS=localhost,127.0.0.1

# Bot defaults
DEFAULT_MODEL=gpt-5.4
DEFAULT_REASONING_EFFORT=xhigh
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
    "openai>=1.60",
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

## 9. Async Bot Execution

Bot calls — especially GlobalAnnotatorBot with `gpt-5.4` at `reasoning_effort: "xhigh"` — are **long-running operations** that typically take **30���50 minutes**. The architecture uses two-tier async polling: the backend polls OpenAI, the frontend polls the backend.

### 9.1 Execution Flow

```
Frontend                    Backend                     OpenAI Responses API
   │                           │                              │
   │ POST /agents/run/         │                              │
   │──────────────────────────>│                              │
   │  {run_id, status:pending} │                              │
   │<──────────────────────────│                              │
   │                           │ POST /v1/responses           │
   │                           │ {background:true, store:true}│
   │                           │─────────────���───────────────>│
   │                           │ {resp_id, status:queued}     │
   │                           │<─────────────────────────────│
   │                           │                              │
   │ GET /agents/runs/{id}/    │                              │
   │──────────────────────────>│ GET /v1/responses/{resp_id}  │
   │  (every 15s)              │─────────────────────────────>│
   │                           │  (every 10s)                 │
   │  {status:running,         │                              │
   │   elapsed: "12m 34s"}     │                              │
   │<──────────────────────────│                              │
   │         ...               │         ...                  │
   ���                           │ {status:completed, output}   │
   │                           │<───────────────���─────────────│
   │                           │ → parse BotOutput            │
   │                           │ → create Annotations, Chunks │
   │                           │ → update AgentRun status     │
   │ GET /agents/runs/{id}/    │                              │
   │──────────────────────────>│                              │
   │  {status:completed, ...}  │                              │
   │<──────────────────────────│                              │
```

**Detailed steps:**

1. `POST /api/v1/documents/{id}/agents/run/` creates an `AgentRun` with status `pending`
2. Backend launches a background thread that:
   - Updates `AgentRun` status to `running`, records `started_at`
   - Builds the `BotInput` (context slice, fragments)
   - Calls the **OpenAI Responses API** with `background: true` and `store: true`:
     ```python
     resp = openai_client.responses.create(
         model=config.model,              # "gpt-5.4"
         instructions=system_prompt,
         input=user_prompt,
         reasoning={"effort": config.reasoning_effort, "summary": "auto"},
         text={"format": {"type": "json_schema", "name": "bot_output",
                          "strict": True, "schema": BOT_OUTPUT_SCHEMA}},
         background=True,
         store=True,
     )
     # Returns immediately with resp.status == "queued"
     ```
   - Stores `resp.id` in `AgentRun.raw_output["openai_response_id"]`
   - **Polls OpenAI** every 10 seconds until terminal state:
     ```python
     while resp.status in ("queued", "in_progress"):
         time.sleep(10)
         resp = openai_client.responses.retrieve(resp.id)
         # Update AgentRun.raw_output with elapsed time for frontend display
     ```
   - On completion: parses `resp.output_text` as `BotOutput`, creates `Annotation` and `Chunk` objects, updates `AgentRun` status to `completed`
   - On failure or timeout: updates status to `failed` with error message
3. Frontend polls `GET /agents/runs/{run_id}/` every **15 seconds** while status is `pending` or `running`

### 9.2 Timeouts and Error Handling

| Concern | Value | Rationale |
|---|---|---|
| Backend → OpenAI poll timeout | **70 minutes** | Hard ceiling to avoid indefinite hangs; allows full xhigh reasoning runs (typically 30–50 min) with margin |
| Frontend → Backend poll interval | **15 seconds** | Frequent enough for responsive UX, light on local network |
| Backend → OpenAI poll interval | **10 seconds** | OpenAI background responses update status asynchronously |
| `max_output_tokens` | **Not set** (model default: 128k) | Setting this too low truncates reasoning tokens with no visible output; the model manages its budget internally |
| `temperature` | **Not configurable** | Rejected by OpenAI API when `reasoning_effort > "none"` |

**Failure modes:**
- OpenAI returns `status: "failed"` → `AgentRun` marked failed, error shown in UI
- 70-minute timeout exceeded → `AgentRun` marked failed with timeout message
- OpenAI response stuck in `"queued"` (known API issue) → caught by timeout; user can cancel and retry
- Network error during polling → retry with exponential backoff (3 retries), then fail

**Cancellation:** The user can cancel a running bot from the UI. Backend calls `openai_client.responses.cancel(resp_id)` (idempotent) and marks the `AgentRun` as `failed` with reason `"cancelled"`.

### 9.3 Frontend UX for Long-Running Calls

Since bot calls take 30–50 minutes, the UI must not block the user or lose state:

- **Persistent status indicator** in the status bar: shows bot name, elapsed time ("GlobalAnnotatorBot — running 12m 34s"), and a cancel button. Visible on all views (document list, document view, settings).
- **Navigate freely**: The user can browse other documents, create annotations manually, or close and reopen the browser tab. The `AgentRun` record in the database is the source of truth — the frontend reconstructs status on page load.
- **Completion notification**: When the frontend poll detects `status: "completed"`, show a toast notification ("GlobalAnnotatorBot finished — 3 issues found, 2 expanded arguments generated") with a link to view results. If the user is already viewing the document, annotations appear automatically.
- **No spinner or modal**: A 30-minute spinner would be hostile UX. The status bar indicator is unobtrusive.

### 9.4 Post-MVP: WebSocket + Server-Sent Events

Replace frontend polling with a persistent connection per session. The backend pushes:
- Bot run status changes (with elapsed time)
- Completion notification with summary
- Chat message streaming

This is out of MVP scope — polling every 15 seconds works fine for a single-user local tool.

---

## 10. Implementation Roadmap

### Phase 1: Skeleton — DONE
- [x] Project structure, Django apps (documents, annotations, agents), React + Vite + TS
- [x] Data models + migrations (including Annotation v2 schema)
- [x] Basic REST endpoints (CRUD for documents, annotations, agent runs)
- [x] Upload form, document list

### Phase 2: Ingestion Pipeline — DONE
- [x] Pandoc integration: LaTeX/Markdown → AST via panflute
- [x] Block ID assignment, environment detection, sentence splitting
- [x] Macro extraction and expansion with source mapping
- [x] Blocks API endpoint
- [x] Frontend: render blocks with MathJax 3

### Phase 3: Document Reader UI + Human Annotations — DONE
- [x] Block-level rendering with `data-block-id` attributes
- [x] Category-based color-coded backgrounds
- [x] Click-to-select blocks, shift-click multi-block ranges
- [x] Annotation panel: category toggles, tag chips, severity badges, connector lines
- [x] Human annotation CRUD (create/edit/delete with category/tags/severity/body)
- [x] Resolve/Revoke/Archive per category
- [x] Settings page: API key management, model selection
- [x] Launcher script (one-command setup)

### Phase 4: GlobalAnnotatorBot
- [ ] Bot contract implementation (`BotInput`/`BotOutput` dataclasses)
- [ ] Context slice builder (notation, theorem/definition index, section path)
- [ ] GlobalAnnotatorBot prompt + LLM call (Anthropic/OpenAI SDK)
- [ ] Output parsing → Annotation v2 objects (category/tags/severity/body)
- [ ] AgentRun tracking + async execution (background thread)
- [ ] Bot wizard dialog (checks toggle, steering prompt, model selector)
- [ ] Polling from frontend for run status
- [ ] Summary sidebar: populated from bot chunks
- [ ] Expanded argument display (inline chevron toggle + View menu options)
- [ ] Triage preset auto-trigger on document creation

### Phase 5: Chat
- [ ] Chat backend: LLM relay with document context in system prompt
- [ ] Chat frontend: message list + input + context indicator
- [ ] SSE streaming for chat responses
- [ ] Selection → chat context integration
- [ ] Quick actions: "Explain this", "Check this step"

### Phase 6: Polish + Testing
- [ ] Error handling and loading states
- [ ] Keyboard shortcuts (next/prev annotation, toggle panels)
- [ ] Test suite: backend API tests, ingestion pipeline tests
- [ ] Test with real mathematical documents
- [ ] README and setup documentation

---

## 11. Open Questions

### Resolved

1. ~~**Sentence splitting quality**~~: **Decision: implement sentence-level IDs from the start.** Rule-based math-aware splitter, imperfect but sufficient. Agents and UI support both block-level and sentence-level anchoring.

2. ~~**Authentication**~~: **Decision: no auth for MVP.** Runs locally, API keys via Settings page, stored in `.env`.

3. ~~**Agent output validation**~~: **Decision: best-effort parse with defaults.** Partial results indicated in UI.

4. ~~**Multi-document**~~: **Decision: minimal dashboard.** Document list + upload button implemented.

5. ~~**Verdict language alignment**~~: **Decision: "confidence summary" not "verdict".** No overall validity judgments, only evidence and confidence indicators.

6. ~~**Annotation model**~~: **Decision: category/tags/severity model (v2).** Implemented. See `notes/annotation-model-spec-v2.md`.

7. ~~**Expanded argument storage**~~: **Decision: model as Info annotations with `expanded_argument` tag.** Displayed inline by default (chevron toggle), with option to show in annotation column via View menu.

### Open

8. **Chat model**: Same model as the bot, or always use the most capable available? Suggestion: user-configurable per document, defaulting to the same model as the bot preset.

9. **Bot rerun behavior**: When a bot is re-run on a document that already has bot annotations, should old annotations be replaced or kept alongside? Options: (a) replace all from that bot type, (b) keep both runs visible with run selector, (c) ask the user. Needs decision before implementing GlobalAnnotatorBot.

10. **Expanded argument scope**: Should the bot produce one `expanded_argument` per chunk, or can it skip chunks where the argument is already explicit? Suggestion: always produce one for consistency; mark trivial ones with low confidence.

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

**GlobalAnnotatorBot output** (abbreviated):

```json
{
    "summary": "Proves 4-colorability for graphs with max degree 3 via induction on vertex count.",
    "chunks": [
        {
            "chunk_id": "chunk_1",
            "source_ids": ["thm1"],
            "summary": "States the main theorem: Δ(G) ≤ 3 implies 4-colorable.",
            "confidence": 0.95
        },
        {
            "chunk_id": "chunk_2",
            "source_ids": ["pf1.p1", "pf1.p2"],
            "summary": "Sets up induction and handles the base case.",
            "confidence": 0.9
        },
        {
            "chunk_id": "chunk_3",
            "source_ids": ["pf1.p3"],
            "summary": "Inductive step: remove a low-degree vertex, color the rest, extend.",
            "confidence": 0.75
        }
    ],
    "annotations": [
        {
            "start_block": "pf1.p2",
            "end_block": "pf1.p2",
            "category": "issue",
            "tags": ["handwaving"],
            "severity": "question",
            "body": "'The result is immediate' — correct but could note that any graph on ≤4 vertices trivially has a proper 4-coloring by assigning distinct colors.",
            "confidence": 0.6,
            "chunk_id": "chunk_2"
        },
        {
            "start_block": "pf1.p3",
            "end_block": "pf1.p3",
            "category": "issue",
            "tags": ["gap"],
            "severity": "warning",
            "body": "The argument implicitly uses that Δ(G-v) ≤ 3 still holds after deleting v (which is true since deleting a vertex cannot increase degrees). This should be stated.",
            "confidence": 0.8,
            "chunk_id": "chunk_3"
        },
        {
            "start_block": "pf1.p3",
            "end_block": "pf1.p3",
            "category": "info",
            "tags": ["expanded_argument"],
            "severity": "",
            "body": "Let v be any vertex of G. Since Δ(G) ≤ 3, we have deg(v) ≤ 3. Consider G' = G - v. For any vertex u in G', deg_{G'}(u) ≤ deg_G(u) ≤ 3, so Δ(G') ≤ 3. Since |V(G')| = n-1, the induction hypothesis gives a proper 4-coloring c of G'. Now v has at most 3 neighbors in G, so at most 3 colors from {1,2,3,4} appear on N(v). Thus at least one color is available; assign it to v. This extends c to a proper 4-coloring of G.",
            "confidence": 0.9,
            "chunk_id": "chunk_3"
        }
    ],
    "overall_confidence": 0.8
}
```

**What the user sees:** The document rendered with the base case paragraph having a yellow background (question-severity issue) and the inductive step having an orange background (warning-severity issue). The inductive step also has a ▸ chevron — clicking it reveals the expanded argument below the text. The summary sidebar shows the three chunks. The annotation panel lists the two issue annotations (the `expanded_argument` info annotation is hidden from the panel by default, displayed inline). Clicking the warning annotation scrolls to the inductive step and highlights it.
