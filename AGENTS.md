# AGENTS.md — Developer & AI-Tool Guide

This file is for **developers** and their AI coding assistants (Claude Code,
Codex, Copilot, etc.).  If you are an end-user, see the README.

## Quick start (developer)

```bash
# Option A — use the launcher (manages its own conda env)
python3 prooflint.py --dev

# Option B — manual setup (if you manage your own Python/Node)
cd backend  && python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
# Pandoc must also be installed on PATH when you skip the launcher.
python manage.py migrate
python manage.py runserver          # terminal 1

cd frontend && npm install
npm run dev                         # terminal 2
```

Backend: http://localhost:8000 — Frontend: http://localhost:5173

## Architecture overview

```
prooflint/
├── prooflint.py          # one-command launcher (stdlib-only, Python 3.8+)
├── .env.example          # environment template
├── backend/              # Django 5 + DRF
│   ├── prooflint/        # project settings, root urls, settings API
│   ├── documents/        # document ingestion & storage
│   ├── annotations/      # proof annotations & verification
│   ├── agents/           # AI agent conversations
│   ├── manage.py
│   └── pyproject.toml
├── frontend/             # React 18 + TypeScript + Vite
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── stores/       # Zustand state stores
│   │   └── types/        # TypeScript types
│   ├── package.json
│   └── vite.config.ts    # dev server + API proxy
└── docker-compose.yml    # alternative: full Docker setup
```

## Key conventions

- **Database:** SQLite for local dev (`backend/db.sqlite3`), PostgreSQL via
  Docker.  Configured by `DATABASE_URL` env var through `dj-database-url`.
- **API prefix:** all endpoints live under `/api/v1/`.
- **Frontend proxy:** Vite proxies `/api` → backend (port from `API_URL` env
  var, defaults to `http://localhost:8000`).
- **CORS:** `CORS_ALLOW_ALL_ORIGINS = True` when `DEBUG = True`; explicit
  origin list in production.
- **Math rendering:** `react-markdown` + `remark-math` + `rehype-mathjax`.
- **Document ingestion:** Pandoc AST → panflute → hierarchical blocks.  Pandoc
  must be on `PATH` (the launcher installs it via conda).

## Running tests

```bash
# Backend
cd backend
pytest

# Lint
ruff check .
```

## Adding a new API endpoint

1. If it belongs to an existing app (`documents`, `annotations`, `agents`),
   add the view + serializer + url there.
2. For project-wide endpoints (e.g. `/api/v1/settings/`), add to
   `backend/prooflint/views.py` and `backend/prooflint/urls.py`.
3. Always register under the `/api/v1/` prefix.

## Adding a new React page / component

1. Create the component in `frontend/src/components/`.
2. Add a route in `frontend/src/App.tsx` using `react-router-dom`.
3. State management: use Zustand stores in `frontend/src/stores/`.

## Environment variables

See `.env.example`.  Key ones:

| Variable              | Required | Purpose                          |
| --------------------- | -------- | -------------------------------- |
| `ANTHROPIC_API_KEY`   | Yes      | Anthropic API for AI agents      |
| `OPENAI_API_KEY`      | No       | Optional OpenAI integration      |
| `DATABASE_URL`        | No       | Override default SQLite database |
| `DEFAULT_MODEL`       | No       | LLM model (default: claude-sonnet-4-6) |
| `DEFAULT_TEMPERATURE` | No       | LLM temperature (default: 0.2)  |

## Known quirks

- **WSL2 + Vite HMR:** hot module reload can be unreliable on Windows
  Subsystem for Linux.  Restart the Vite dev server if edits don't appear.
- **MathJax selection:** rendered math is currently not selectable/copyable.
- **Source offsets:** `source_offset_start/end` in document blocks are not yet
  computed (all zero).
