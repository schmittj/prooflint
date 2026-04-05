import logging

from django.conf import settings
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from agents.models import AgentRun
from agents.runner import launch_bot_run

from .ingestion import ingest_document
from .models import Block, Document
from .serializers import (
    BlockSerializer,
    DocumentCreateSerializer,
    DocumentDetailSerializer,
    DocumentListSerializer,
)

logger = logging.getLogger(__name__)


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

        doc = Document.objects.create(
            title=data.get("title", ""),
            original_source=data["source"],
            source_format=data["source_format"],
            preset=data["preset"],
        )

        # Run ingestion pipeline
        try:
            blocks = ingest_document(doc)
            logger.info("Ingested document %s: %d blocks", doc.id, len(blocks))
        except Exception:
            logger.exception("Ingestion failed for document %s", doc.id)
            # Document is still created, just without blocks

        # Auto-trigger GlobalAnnotatorBot for triage preset
        if doc.preset == "triage" and settings.OPENAI_API_KEY:
            try:
                # Use DEFAULT_MODEL only if it's an OpenAI model; the bot
                # runner calls the OpenAI Responses API so Claude/Gemini
                # model names would be rejected.
                model = settings.DEFAULT_MODEL
                if not model.startswith("gpt-"):
                    model = "gpt-5.4-mini"
                run = AgentRun.objects.create(
                    document=doc,
                    agent_type="global_annotator",
                    model=model,
                    preset="triage",
                    config={"reasoning_effort": settings.DEFAULT_REASONING_EFFORT},
                )
                launch_bot_run(run)
                logger.info("Auto-triggered GlobalAnnotatorBot for triage document %s", doc.id)
            except Exception:
                logger.exception("Failed to auto-trigger bot for document %s", doc.id)

        out = DocumentDetailSerializer(doc)
        return Response(out.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="blocks")
    def blocks(self, request, pk=None):
        doc = self.get_object()
        blocks = Block.objects.filter(document=doc)
        serializer = BlockSerializer(blocks, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="reingest")
    def reingest(self, request, pk=None):
        """Re-run the ingestion pipeline on an existing document."""
        doc = self.get_object()
        try:
            blocks = ingest_document(doc)
            return Response(
                {"status": "ok", "block_count": len(blocks)},
                status=status.HTTP_200_OK,
            )
        except Exception as e:
            logger.exception("Re-ingestion failed for document %s", doc.id)
            return Response(
                {"status": "error", "detail": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=["get"], url_path="source")
    def source(self, request, pk=None):
        doc = self.get_object()
        return Response(
            {
                "source": doc.original_source,
                "source_format": doc.source_format,
            }
        )
