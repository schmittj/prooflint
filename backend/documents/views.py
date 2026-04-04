from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Block, Document
from .serializers import (
    BlockSerializer,
    DocumentCreateSerializer,
    DocumentDetailSerializer,
    DocumentListSerializer,
)


class DocumentViewSet(viewsets.ModelViewSet):
    queryset = Document.objects.all()

    def get_serializer_class(self):
        if self.action == "list":
            return DocumentListSerializer
        if self.action == "create":
            return DocumentCreateSerializer
        return DocumentDetailSerializer

    def create(self, request, *args, **kwargs):
        serializer = DocumentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Create the document (ingestion pipeline will be added in Phase 2)
        doc = Document.objects.create(
            title=data.get("title", ""),
            original_source=data["source"],
            source_format=data["source_format"],
            preset=data["preset"],
            expanded_source=data["source"],  # placeholder until ingestion pipeline
        )

        # TODO: Phase 2 — run ingestion pipeline here
        # TODO: Phase 4 — if preset == "triage", kick off GlobalAnnotator

        out = DocumentDetailSerializer(doc)
        return Response(out.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="blocks")
    def blocks(self, request, pk=None):
        doc = self.get_object()
        blocks = Block.objects.filter(document=doc)
        serializer = BlockSerializer(blocks, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["get"], url_path="source")
    def source(self, request, pk=None):
        doc = self.get_object()
        return Response(
            {
                "source": doc.original_source,
                "source_format": doc.source_format,
            }
        )
