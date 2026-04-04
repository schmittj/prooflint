from rest_framework import serializers

from .models import Annotation


class AnnotationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Annotation
        fields = [
            "id",
            "block_id",
            "sentence_id",
            "anchor_offset_start",
            "anchor_offset_end",
            "anchor_quote",
            "source",
            "agent_run",
            "chunk",
            "annotation_type",
            "severity",
            "message",
            "confidence",
            "resolved",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class AnnotationCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Annotation
        fields = [
            "block_id",
            "sentence_id",
            "anchor_offset_start",
            "anchor_offset_end",
            "anchor_quote",
            "annotation_type",
            "severity",
            "message",
        ]

    def create(self, validated_data):
        validated_data["source"] = "human"
        return super().create(validated_data)
