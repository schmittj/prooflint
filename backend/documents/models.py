import uuid

from django.db import models


class Document(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=500, blank=True)

    # Source
    original_source = models.TextField()
    source_format = models.CharField(
        max_length=20,
        choices=[("latex", "LaTeX"), ("markdown", "Markdown+LaTeX")],
    )

    # Processed content
    macro_table = models.JSONField(default=dict, blank=True)
    theorem_env_table = models.JSONField(default=dict, blank=True)
    expanded_source = models.TextField(blank=True)
    source_map = models.JSONField(default=list, blank=True)

    # Structure (built during ingestion)
    structure = models.JSONField(default=dict, blank=True)

    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Agent state
    preset = models.CharField(
        max_length=20,
        choices=[("manual", "Manual"), ("triage", "Triage"), ("audit", "Audit")],
        default="manual",
    )
    agent_status = models.CharField(
        max_length=20,
        choices=[
            ("idle", "Idle"),
            ("running", "Running"),
            ("completed", "Completed"),
            ("failed", "Failed"),
        ],
        default="idle",
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title or f"Document {self.id}"


class Block(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        Document, related_name="blocks", on_delete=models.CASCADE
    )

    # Document-local display ID (e.g. "p3", "thm1")
    block_id = models.CharField(max_length=50)

    # Ordering and hierarchy
    order = models.PositiveIntegerField()
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        related_name="children",
        on_delete=models.CASCADE,
    )

    # Type
    block_type = models.CharField(
        max_length=30,
        choices=[
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
            ("blockquote", "Blockquote"),
        ],
    )

    # Content
    content_original = models.TextField()
    content_expanded = models.TextField(blank=True)
    content_html = models.TextField(blank=True)

    # Source mapping (byte offsets in the original source)
    source_offset_start = models.PositiveIntegerField(default=0)
    source_offset_end = models.PositiveIntegerField(default=0)

    # Sentence decomposition
    sentences = models.JSONField(default=list, blank=True)

    # TikZ rendering
    rendered_svg_path = models.CharField(max_length=500, blank=True)

    # Labels
    label = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["order"]
        constraints = [
            models.UniqueConstraint(
                fields=["document", "block_id"],
                name="unique_block_id_per_document",
            )
        ]

    def __str__(self):
        return f"{self.block_id} ({self.block_type})"
