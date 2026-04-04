# ProofLint

AI-assisted proof review workbench. Upload mathematical writing (LaTeX or Markdown+LaTeX), get structural analysis with AI-generated annotations, and review proofs with an interactive chatbot.

**Status:** Pre-MVP development.

## Quick Start (End Users)

Prerequisites: Python 3.11+

```bash
git clone https://github.com/schmittj/prooflint.git
cd prooflint
# Coming soon: ./install.sh
```

## Development Setup (Contributors)

### With Docker

```bash
cp .env.example .env
# Edit .env to add your ANTHROPIC_API_KEY
docker compose up
```

- Backend: http://localhost:8000
- Frontend: http://localhost:5173
- API docs: http://localhost:8000/api/v1/

### Without Docker

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
python manage.py migrate
python manage.py runserver

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

## Architecture

- **Backend:** Django 5 + Django REST Framework
- **Frontend:** React 18 + TypeScript + Vite + Zustand
- **Ingestion:** Pandoc (LaTeX/Markdown AST) + panflute
- **Math rendering:** MathJax 3
- **Database:** SQLite (local) / PostgreSQL (Docker/production)

See `ProofLint-MVP-Spec.md` for the full technical specification.

## License

MIT
