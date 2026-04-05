from rest_framework import serializers

from .models import Annotation


class AnnotationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Annotation
        fields = [
            "id",
            # anchor
            "start_block",
            "end_block",
            "start_offset",
            "end_offset",
            "anchor_quote",
            # provenance
            "source",
            "author",
            "agent_run",
            "chunk",
            "confidence",
            # content
            "category",
            "tags",
            "severity",
            "body",
            "metadata",
            # lifecycle
            "resolved",
            "resolved_at",
            "resolved_by",
            # links
            "related_annotations",
            # timestamps
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class AnnotationCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Annotation
        fields = [
            "start_block",
            "end_block",
            "start_offset",
            "end_offset",
            "anchor_quote",
            "category",
            "tags",
            "severity",
            "body",
            "metadata",
        ]
        extra_kwargs = {
            "end_block": {"required": False},
        }

    def validate(self, data):
        # Default end_block to start_block for single-block annotations
        if "end_block" not in data or not data["end_block"]:
            data["end_block"] = data["start_block"]
        # Severity is required for issues
        if data.get("category") == "issue" and not data.get("severity"):
            raise serializers.ValidationError(
                {"severity": "Severity is required for issue annotations."}
            )
        return data

    def create(self, validated_data):
        validated_data["source"] = "human"
        return super().create(validated_data)
