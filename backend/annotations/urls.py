from django.urls import path

from .views import AnnotationViewSet

annotation_list = AnnotationViewSet.as_view({"get": "list", "post": "create"})
annotation_detail = AnnotationViewSet.as_view(
    {"patch": "partial_update", "delete": "destroy"}
)

urlpatterns = [
    path(
        "documents/<uuid:document_pk>/annotations/",
        annotation_list,
        name="annotation-list",
    ),
    path(
        "documents/<uuid:document_pk>/annotations/<uuid:pk>/",
        annotation_detail,
        name="annotation-detail",
    ),
]
