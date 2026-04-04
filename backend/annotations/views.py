from rest_framework import mixins, viewsets
from rest_framework.response import Response

from .models import Annotation
from .serializers import AnnotationCreateSerializer, AnnotationSerializer


class AnnotationViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = AnnotationSerializer

    def get_queryset(self):
        doc_id = self.kwargs["document_pk"]
        qs = Annotation.objects.filter(document_id=doc_id)

        # Filters
        source = self.request.query_params.get("source")
        if source:
            qs = qs.filter(source=source)

        severity = self.request.query_params.get("severity")
        if severity:
            qs = qs.filter(severity__in=severity.split(","))

        block_id = self.request.query_params.get("block_id")
        if block_id:
            qs = qs.filter(block_id=block_id)

        return qs

    def get_serializer_class(self):
        if self.action == "create":
            return AnnotationCreateSerializer
        return AnnotationSerializer

    def perform_create(self, serializer):
        serializer.save(document_id=self.kwargs["document_pk"])
