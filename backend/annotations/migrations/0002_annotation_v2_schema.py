"""
Annotation v2 schema overhaul.

Replaces annotation_type/severity/block_id with category/tags/severity(new choices)
and span-based anchoring. Adds metadata, author, lifecycle fields, and M2M links.

This is a destructive migration — existing annotation rows will be deleted.
Acceptable for MVP with minimal test data.
"""

import uuid
from django.db import migrations, models


def forward(apps, schema_editor):
    """Delete existing annotations before schema change — MVP has no production data."""
    Annotation = apps.get_model("annotations", "Annotation")
    count = Annotation.objects.count()
    if count > 0:
        Annotation.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("annotations", "0001_initial"),
    ]

    operations = [
        # Step 1: Delete existing rows (safe for MVP)
        migrations.RunPython(forward, migrations.RunPython.noop),

        # Step 2: Remove old fields
        migrations.RemoveField(model_name="annotation", name="block_id"),
        migrations.RemoveField(model_name="annotation", name="sentence_id"),
        migrations.RemoveField(model_name="annotation", name="anchor_offset_start"),
        migrations.RemoveField(model_name="annotation", name="anchor_offset_end"),
        migrations.RemoveField(model_name="annotation", name="annotation_type"),
        migrations.RemoveField(model_name="annotation", name="message"),

        # Step 3: Add new fields
        # Anchor
        migrations.AddField(
            model_name="annotation",
            name="start_block",
            field=models.CharField(max_length=50, default=""),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="annotation",
            name="end_block",
            field=models.CharField(max_length=50, default=""),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="annotation",
            name="start_offset",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="annotation",
            name="end_offset",
            field=models.PositiveIntegerField(default=0),
        ),
        # anchor_quote already exists from v1

        # Provenance
        migrations.AddField(
            model_name="annotation",
            name="author",
            field=models.CharField(blank=True, max_length=200),
        ),

        # Content
        migrations.AddField(
            model_name="annotation",
            name="category",
            field=models.CharField(
                choices=[("check", "Check"), ("info", "Info"), ("issue", "Issue")],
                max_length=10,
                default="issue",
            ),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="annotation",
            name="tags",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="annotation",
            name="body",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="annotation",
            name="metadata",
            field=models.JSONField(blank=True, default=dict),
        ),

        # Update severity choices (was info/warning/error, now question/warning/error)
        migrations.AlterField(
            model_name="annotation",
            name="severity",
            field=models.CharField(
                blank=True,
                choices=[
                    ("question", "Question"),
                    ("warning", "Warning"),
                    ("error", "Error"),
                ],
                max_length=20,
            ),
        ),

        # Lifecycle
        migrations.AddField(
            model_name="annotation",
            name="resolved_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="annotation",
            name="resolved_by",
            field=models.CharField(blank=True, max_length=200),
        ),

        # Links
        migrations.AddField(
            model_name="annotation",
            name="related_annotations",
            field=models.ManyToManyField(blank=True, to="annotations.annotation"),
        ),

        # Update ordering
        migrations.AlterModelOptions(
            name="annotation",
            options={"ordering": ["start_block", "created_at"]},
        ),
    ]
