from django.shortcuts import get_object_or_404
from rest_framework import mixins, viewsets

from documents.models import Document

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
        get_object_or_404(Document, pk=doc_id)
        qs = Annotation.objects.filter(document_id=doc_id)

        source = self.request.query_params.get("source")
        if source:
            qs = qs.filter(source=source)

        severity = self.request.query_params.get("severity")
        if severity:
            qs = qs.filter(severity__in=severity.split(","))

        category = self.request.query_params.get("category")
        if category:
            qs = qs.filter(category__in=category.split(","))

        # TODO: once multi-block spans exist, also match annotations where
        # block_id falls between start_block and end_block (requires block ordering).
        block_id = self.request.query_params.get("block_id")
        if block_id:
            qs = qs.filter(start_block=block_id)

        return qs

    def get_serializer_class(self):
        if self.action == "create":
            return AnnotationCreateSerializer
        return AnnotationSerializer

    def perform_create(self, serializer):
        doc_id = self.kwargs["document_pk"]
        get_object_or_404(Document, pk=doc_id)
        instance = serializer.save(document_id=doc_id)
        self._created_instance = instance

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        if hasattr(self, "_created_instance"):
            response.data = AnnotationSerializer(self._created_instance).data
        return response
