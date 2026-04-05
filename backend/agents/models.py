import uuid

from django.db import models


class AgentRun(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        "documents.Document", related_name="agent_runs", on_delete=models.CASCADE
    )

    agent_type = models.CharField(max_length=50)  # e.g. "global_annotator"
    status = models.CharField(
        max_length=20,
        choices=[
            ("pending", "Pending"),
            ("running", "Running"),
            ("completed", "Completed"),
            ("failed", "Failed"),
        ],
        default="pending",
    )

    # Configuration
    model = models.CharField(max_length=100)
    preset = models.CharField(max_length=20)
    config = models.JSONField(default=dict, blank=True)

    # External API tracking
    openai_response_id = models.CharField(max_length=100, blank=True)

    # Results
    raw_output = models.JSONField(null=True, blank=True)
    error_message = models.TextField(blank=True)

    # Cost tracking
    input_tokens = models.PositiveIntegerField(null=True, blank=True)
    output_tokens = models.PositiveIntegerField(null=True, blank=True)

    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.agent_type} — {self.status}"


class Chunk(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agent_run = models.ForeignKey(
        AgentRun, related_name="chunks", on_delete=models.CASCADE
    )
    document = models.ForeignKey(
        "documents.Document", related_name="chunks", on_delete=models.CASCADE
    )

    chunk_id = models.CharField(max_length=50)  # e.g. "chunk_1"
    source_block_ids = models.JSONField()  # ["p3", "p4", "p5"]

    summary = models.TextField()
    confidence = models.FloatField()
    # Note: expanded arguments are stored as info annotations (tag "expanded_argument")
    # linked to this chunk via Annotation.chunk FK.

    order = models.PositiveIntegerField()

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return f"{self.chunk_id}: {self.summary[:60]}"


class ChatMessage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        "documents.Document", related_name="chat_messages", on_delete=models.CASCADE
    )

    role = models.CharField(
        max_length=20,
        choices=[("user", "User"), ("assistant", "Assistant"), ("system", "System")],
    )
    content = models.TextField()

    selected_block_id = models.CharField(max_length=50, blank=True)
    selected_text = models.TextField(blank=True)

    model = models.CharField(max_length=100, blank=True)
    input_tokens = models.PositiveIntegerField(null=True, blank=True)
    output_tokens = models.PositiveIntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.role}: {self.content[:60]}"
