from rest_framework import serializers

from .models import AgentRun, ChatMessage, Chunk


class ChunkSerializer(serializers.ModelSerializer):
    class Meta:
        model = Chunk
        fields = [
            "id",
            "chunk_id",
            "source_block_ids",
            "summary",
            "expanded_argument",
            "confidence",
            "order",
        ]


class AgentRunSerializer(serializers.ModelSerializer):
    chunks = ChunkSerializer(many=True, read_only=True)

    class Meta:
        model = AgentRun
        fields = [
            "id",
            "agent_type",
            "status",
            "model",
            "preset",
            "raw_output",
            "error_message",
            "input_tokens",
            "output_tokens",
            "started_at",
            "completed_at",
            "created_at",
        ]


class AgentRunCreateSerializer(serializers.Serializer):
    agent_type = serializers.CharField(default="global_annotator")
    config = serializers.DictField(required=False, default=dict)


class ChatMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatMessage
        fields = [
            "id",
            "role",
            "content",
            "selected_block_id",
            "selected_text",
            "model",
            "input_tokens",
            "output_tokens",
            "created_at",
        ]
        read_only_fields = ["id", "role", "model", "input_tokens", "output_tokens", "created_at"]


class ChatMessageCreateSerializer(serializers.Serializer):
    content = serializers.CharField()
    selected_block_id = serializers.CharField(required=False, default="")
    selected_text = serializers.CharField(required=False, default="")
