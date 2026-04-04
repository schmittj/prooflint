from django.contrib import admin

from .models import Block, Document


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ["title", "source_format", "preset", "agent_status", "created_at"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(Block)
class BlockAdmin(admin.ModelAdmin):
    list_display = ["block_id", "document", "block_type", "order"]
    list_filter = ["block_type"]
