import uuid

from django.db import models


class Annotation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        "documents.Document", related_name="annotations", on_delete=models.CASCADE
    )

    # Anchoring — multi-level precision
    block_id = models.CharField(max_length=50)
    sentence_id = models.CharField(max_length=50, blank=True)

    # Character-range anchoring (for precise human selections)
    anchor_offset_start = models.PositiveIntegerField(null=True, blank=True)
    anchor_offset_end = models.PositiveIntegerField(null=True, blank=True)
    anchor_quote = models.TextField(blank=True)

    # Source
    source = models.CharField(
        max_length=20,
        choices=[("human", "Human"), ("agent", "AI Agent")],
    )
    agent_run = models.ForeignKey(
        "agents.AgentRun",
        null=True,
        blank=True,
        related_name="annotations",
        on_delete=models.SET_NULL,
    )
    chunk = models.ForeignKey(
        "agents.Chunk",
        null=True,
        blank=True,
        related_name="annotations",
        on_delete=models.SET_NULL,
    )

    # Content
    ANNOTATION_TYPE_CHOICES = [
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
    ]
    annotation_type = models.CharField(max_length=30, choices=ANNOTATION_TYPE_CHOICES)
    severity = models.CharField(
        max_length=20,
        choices=[("info", "Info"), ("warning", "Warning"), ("error", "Error")],
        default="info",
    )
    message = models.TextField()

    # AI metadata
    confidence = models.FloatField(null=True, blank=True)

    # Human metadata
    resolved = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["block_id", "created_at"]

    def __str__(self):
        return f"{self.annotation_type} on {self.block_id}"
