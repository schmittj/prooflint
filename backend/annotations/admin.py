from django.contrib import admin

from .models import Annotation


@admin.register(Annotation)
class AnnotationAdmin(admin.ModelAdmin):
    list_display = ["category", "start_block", "source", "severity", "resolved"]
    list_filter = ["source", "severity", "category"]
