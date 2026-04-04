from django.urls import path

from .views import AgentRunViewSet, chat_view

agent_run_list = AgentRunViewSet.as_view({"get": "list", "post": "create"})
agent_run_detail = AgentRunViewSet.as_view({"get": "retrieve"})

urlpatterns = [
    path(
        "documents/<uuid:document_pk>/agents/runs/",
        agent_run_list,
        name="agent-run-list",
    ),
    path(
        "documents/<uuid:document_pk>/agents/runs/<uuid:pk>/",
        agent_run_detail,
        name="agent-run-detail",
    ),
    path(
        "documents/<uuid:document_pk>/chat/",
        chat_view,
        name="chat",
    ),
]
