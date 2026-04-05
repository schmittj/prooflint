from django.contrib import admin
from django.urls import include, path

from . import views

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/settings/", views.SettingsView.as_view(), name="settings"),
    path("api/v1/health/", views.HealthView.as_view(), name="health"),
    path("api/v1/shutdown/", views.ShutdownView.as_view(), name="shutdown"),
    path("api/v1/", include("documents.urls")),
    path("api/v1/", include("annotations.urls")),
    path("api/v1/", include("agents.urls")),
]
