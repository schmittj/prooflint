# ProofLint

AI-assisted proof review workbench.  Upload mathematical writing (LaTeX or
Markdown+LaTeX), get structural analysis with AI-generated annotations, and
review proofs with an interactive chatbot.

**Status:** pre-MVP development.

---

## Getting Started

**Prerequisite:** Python 3.8+ and Git.  Everything else is handled
automatically.

```bash
git clone https://github.com/schmittj/prooflint.git
cd prooflint
python3 prooflint.py
```

On the first run the launcher will:

1. Install [Miniforge](https://github.com/conda-forge/miniforge) (if no
   conda/mamba is found) — a small, open-source package manager (~60 MB).
2. Create an isolated `prooflint` environment with Python 3.11, Node.js, and
   Pandoc.
3. Install all backend and frontend dependencies.
4. Set up the local database.
5. Start the application and open your browser.

On subsequent runs it skips straight to step 5 — startup is near-instant.

### Configuring API keys

ProofLint needs an Anthropic API key to power its AI features.  You can set
it in **two ways:**

- **In the browser:** open the Settings page and paste your key.  A clear
  notice confirms that all data stays on your local machine.
- **Manually:** copy `.env.example` to `.env` and fill in your
  `ANTHROPIC_API_KEY`.

### Launcher options

```
python3 prooflint.py              # install if needed, then start
python3 prooflint.py --dev        # verbose server logs, no auto-open browser
python3 prooflint.py --install    # install only, don't start servers
python3 prooflint.py --reset      # recreate environment from scratch
```

### Troubleshooting

| Symptom | Fix |
|---|---|
| `python3: command not found` | Install Python from [python.org](https://www.python.org/downloads/) or your system package manager.  On Windows, `python prooflint.py` may work instead. |
| Miniforge install fails | Install it manually from [github.com/conda-forge/miniforge](https://github.com/conda-forge/miniforge), then re-run `python3 prooflint.py`. |
| Port already in use | The launcher auto-selects free ports.  If it still fails, stop other services on ports 8000/5173. |
| Changes not appearing (WSL2) | Hot-reload can be unreliable on WSL2.  Stop with Ctrl+C and run again. |
| Something else is broken | Run `python3 prooflint.py --reset` to rebuild the environment. |

---

## For Developers

See [AGENTS.md](AGENTS.md) for the full architecture guide, test commands,
and conventions — also useful for AI coding tools (Claude Code, Codex, etc.).

### Manual setup (without the launcher)

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
python manage.py migrate
python manage.py runserver

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

### With Docker

```bash
cp .env.example .env   # edit to add your ANTHROPIC_API_KEY
docker compose up
```

---

## Architecture

| Layer | Stack |
|---|---|
| Backend | Django 5 + Django REST Framework |
| Frontend | React 18 + TypeScript + Vite + Zustand |
| Ingestion | Pandoc AST + panflute |
| Math rendering | MathJax 3 via react-markdown |
| Database | SQLite (local) / PostgreSQL (Docker) |

See `ProofLint-MVP-Spec.md` for the full technical specification.

## License

MIT
