from django.contrib import admin

from .models import AgentRun, ChatMessage, Chunk


@admin.register(AgentRun)
class AgentRunAdmin(admin.ModelAdmin):
    list_display = ["agent_type", "status", "model", "created_at"]
    list_filter = ["status", "agent_type"]


@admin.register(Chunk)
class ChunkAdmin(admin.ModelAdmin):
    list_display = ["chunk_id", "agent_run", "confidence", "order"]


@admin.register(ChatMessage)
class ChatMessageAdmin(admin.ModelAdmin):
    list_display = ["role", "document", "created_at"]
    list_filter = ["role"]
