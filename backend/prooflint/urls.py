from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include("documents.urls")),
    path("api/v1/", include("annotations.urls")),
    path("api/v1/", include("agents.urls")),
]
