from django.shortcuts import get_object_or_404
from rest_framework import mixins, viewsets

from documents.models import Block, Document

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

        # Match annotations whose span contains the queried block.
        # Uses block ordering to check start_block <= block_id <= end_block.
        block_id = self.request.query_params.get("block_id")
        if block_id:
            # Build a lookup of block_id → order for this document
            block_orders = dict(
                Block.objects.filter(document_id=doc_id).values_list("block_id", "order")
            )
            target_order = block_orders.get(block_id)
            if target_order is not None:
                # Find annotation IDs whose span contains this block
                matching_ids = []
                for ann in qs:
                    start_ord = block_orders.get(ann.start_block)
                    end_ord = block_orders.get(ann.end_block)
                    if start_ord is not None and end_ord is not None:
                        if start_ord <= target_order <= end_ord:
                            matching_ids.append(ann.pk)
                qs = qs.filter(pk__in=matching_ids)
            else:
                # Unknown block_id — fall back to exact match on start_block
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
