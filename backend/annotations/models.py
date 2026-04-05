import uuid

from django.db import models


class Annotation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        "documents.Document", related_name="annotations", on_delete=models.CASCADE
    )

    # ── Anchor ──
    # String block IDs (not FKs) to survive re-ingestion which recreates Block rows.
    start_block = models.CharField(max_length=50)
    end_block = models.CharField(max_length=50)
    start_offset = models.PositiveIntegerField(default=0)
    end_offset = models.PositiveIntegerField(null=True, blank=True)  # null = end of block
    anchor_quote = models.TextField(blank=True)

    # ── Provenance ──
    source = models.CharField(
        max_length=20,
        choices=[("human", "Human"), ("agent", "AI Agent")],
    )
    author = models.CharField(max_length=200, default="Human")
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
    confidence = models.FloatField(null=True, blank=True)

    # ── Content ──
    CATEGORY_CHOICES = [
        ("check", "Check"),
        ("info", "Info"),
        ("issue", "Issue"),
    ]
    category = models.CharField(max_length=10, choices=CATEGORY_CHOICES)
    tags = models.JSONField(default=list, blank=True)

    SEVERITY_CHOICES = [
        ("question", "Question"),
        ("warning", "Warning"),
        ("error", "Error"),
    ]
    severity = models.CharField(
        max_length=20,
        choices=SEVERITY_CHOICES,
        blank=True,
    )
    body = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    # ── Lifecycle ──
    resolved = models.BooleanField(default=False)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.CharField(max_length=200, blank=True)

    # ── Links ──
    related_annotations = models.ManyToManyField("self", blank=True, symmetrical=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["start_block", "created_at"]

    def __str__(self):
        tags_str = ",".join(self.tags) if self.tags else "no-tags"
        return f"{self.category}:{tags_str} on {self.start_block}"
