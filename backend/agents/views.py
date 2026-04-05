from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from documents.models import Document

from .models import AgentRun, ChatMessage
from .runner import cancel_bot_run, launch_bot_run
from .serializers import (
    AgentRunCreateSerializer,
    AgentRunSerializer,
    ChatMessageCreateSerializer,
    ChatMessageSerializer,
)


class AgentRunViewSet(viewsets.GenericViewSet):
    serializer_class = AgentRunSerializer

    def get_queryset(self):
        doc_id = self.kwargs["document_pk"]
        get_object_or_404(Document, pk=doc_id)
        return AgentRun.objects.filter(document_id=doc_id)

    def list(self, request, document_pk=None):
        qs = self.get_queryset()
        serializer = AgentRunSerializer(qs, many=True)
        return Response(serializer.data)

    def retrieve(self, request, document_pk=None, pk=None):
        qs = self.get_queryset()
        run = get_object_or_404(qs, pk=pk)
        serializer = AgentRunSerializer(run)
        return Response(serializer.data)

    def create(self, request, document_pk=None):
        doc = get_object_or_404(Document, pk=document_pk)
        serializer = AgentRunCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        run = AgentRun.objects.create(
            document_id=document_pk,
            agent_type=data["agent_type"],
            model=data["config"].get("model", settings.DEFAULT_MODEL),
            preset=doc.preset,
            config=data["config"],
        )

        # Launch the bot in a background thread
        launch_bot_run(run)

        out = AgentRunSerializer(run)
        return Response(out.data, status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, document_pk=None, pk=None):
        qs = self.get_queryset()
        run = get_object_or_404(qs, pk=pk)
        if run.status not in ("pending", "running"):
            return Response(
                {"detail": f"Cannot cancel run with status '{run.status}'"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        cancel_bot_run(run)
        out = AgentRunSerializer(run)
        return Response(out.data)


@api_view(["GET", "POST"])
def chat_view(request, document_pk):
    get_object_or_404(Document, pk=document_pk)

    if request.method == "GET":
        messages = ChatMessage.objects.filter(document_id=document_pk)
        serializer = ChatMessageSerializer(messages, many=True)
        return Response(serializer.data)

    serializer = ChatMessageCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    ChatMessage.objects.create(
        document_id=document_pk,
        role="user",
        content=data["content"],
        selected_block_id=data.get("selected_block_id", ""),
        selected_text=data.get("selected_text", ""),
    )

    # TODO: Phase 5 — call LLM and stream response
    assistant_msg = ChatMessage.objects.create(
        document_id=document_pk,
        role="assistant",
        content="Chat is not yet implemented. Coming in Phase 5.",
        model="placeholder",
    )

    serializer = ChatMessageSerializer(assistant_msg)
    return Response(serializer.data)
