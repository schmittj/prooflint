from rest_framework import serializers

from .models import Block, Document


class BlockSerializer(serializers.ModelSerializer):
    display_label = serializers.SerializerMethodField()

    class Meta:
        model = Block
        fields = [
            "id",
            "block_id",
            "block_type",
            "display_label",
            "content_original",
            "content_expanded",
            "order",
            "parent",
            "sentences",
            "label",
        ]

    def get_display_label(self, obj):
        labels = {
            "theorem": "Theorem",
            "lemma": "Lemma",
            "proposition": "Proposition",
            "corollary": "Corollary",
            "definition": "Definition",
            "remark": "Remark",
        }
        if obj.block_type == "proof":
            return "Proof"
        label = labels.get(obj.block_type)
        if not label:
            return ""
        count = obj.document.blocks.filter(
            parent__isnull=True,
            block_type__in=labels,
            order__lte=obj.order,
        ).count()
        return f"{label} {count}"


class DocumentListSerializer(serializers.ModelSerializer):
    block_count = serializers.IntegerField(source="blocks.count", read_only=True)

    class Meta:
        model = Document
        fields = [
            "id",
            "title",
            "source_format",
            "preset",
            "agent_status",
            "block_count",
            "created_at",
            "updated_at",
        ]


class DocumentDetailSerializer(serializers.ModelSerializer):
    blocks = BlockSerializer(many=True, read_only=True)

    class Meta:
        model = Document
        fields = [
            "id",
            "title",
            "source_format",
            "preset",
            "agent_status",
            "structure",
            "macro_table",
            "blocks",
            "created_at",
            "updated_at",
        ]


class DocumentCreateSerializer(serializers.Serializer):
    source = serializers.CharField()
    source_format = serializers.ChoiceField(choices=["latex", "markdown"])
    title = serializers.CharField(required=False, allow_blank=True, default="")
    preset = serializers.ChoiceField(
        choices=["manual", "triage"], default="manual"
    )
