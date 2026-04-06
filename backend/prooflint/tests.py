import json
from unittest.mock import patch

import pytest

from prooflint import views


@pytest.fixture
def admin_token(settings):
    token = "test-local-admin-token"
    settings.PROOFLINT_ADMIN_TOKEN = token
    return token


@pytest.fixture
def temp_env_file(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    monkeypatch.setattr(views, "ENV_FILE", env_file)
    return env_file


def test_local_session_rejects_non_local_origin(client, admin_token):
    response = client.get(
        "/api/v1/local-session/",
        HTTP_ORIGIN="https://evil.example",
    )

    assert response.status_code == 403


def test_local_session_returns_admin_token(client, admin_token):
    response = client.get(
        "/api/v1/local-session/",
        HTTP_ORIGIN="http://localhost:5173",
    )

    assert response.status_code == 200
    assert response.json() == {"admin_token": admin_token}


def test_settings_write_requires_admin_token(client, temp_env_file, admin_token):
    response = client.post(
        "/api/v1/settings/",
        data=json.dumps({"DEFAULT_MODEL": "gpt-5.4-mini"}),
        content_type="application/json",
        HTTP_ORIGIN="http://localhost:5173",
    )

    assert response.status_code == 403
    assert not temp_env_file.exists()


def test_settings_write_accepts_valid_admin_token(client, temp_env_file, admin_token):
    response = client.post(
        "/api/v1/settings/",
        data=json.dumps({"DEFAULT_MODEL": "gpt-5.4-mini"}),
        content_type="application/json",
        HTTP_ORIGIN="http://localhost:5173",
        HTTP_X_PROOFLINT_ADMIN_TOKEN=admin_token,
    )

    assert response.status_code == 200
    assert "DEFAULT_MODEL=gpt-5.4-mini" in temp_env_file.read_text()


def test_shutdown_requires_admin_token(client, admin_token):
    response = client.post(
        "/api/v1/shutdown/",
        HTTP_ORIGIN="http://localhost:5173",
    )

    assert response.status_code == 403


def test_shutdown_accepts_valid_admin_token(client, admin_token):
    with patch("prooflint.views.os.kill") as mocked_kill:
        response = client.post(
            "/api/v1/shutdown/",
            HTTP_ORIGIN="http://localhost:5173",
            HTTP_X_PROOFLINT_ADMIN_TOKEN=admin_token,
        )

    assert response.status_code == 200
    mocked_kill.assert_called()
