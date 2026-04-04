from django.contrib import admin

from .models import Annotation


@admin.register(Annotation)
class AnnotationAdmin(admin.ModelAdmin):
    list_display = ["annotation_type", "block_id", "source", "severity", "resolved"]
    list_filter = ["source", "severity", "annotation_type"]
