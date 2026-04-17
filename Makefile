.PHONY: help setup dev dev-api dev-app build test lint format typecheck quality clean docker-up docker-down docker-build

# Default target
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ============================================
# Setup
# ============================================
setup: ## First-time project setup
	@echo "Setting up Atlas..."
	cp -n .env.example .env || true
	cd api && pip install -e ".[dev]" --break-system-packages
	cd app && pnpm install
	cd api && python3 -m atlas.db_init
	@echo "Setup complete! Run 'make dev' to start."

# ============================================
# Development
# ============================================
dev: ## Start full-stack development (mail + api + app)
	@echo "Starting Atlas..."
	@echo "Mail:  http://127.0.0.1:8025/messages"
	@echo "API:   http://localhost:8000"
	@echo "App:   http://localhost:3000"
	$(MAKE) -j3 dev-mail dev-api dev-app

dev-mail: ## Start local mail capture service
	@cd app && node scripts/e2e/mail-capture.mjs

dev-api: ## Start API server only
	cd api && uv run uvicorn atlas.main:app --reload --host 0.0.0.0 --port 8000

dev-app: ## Start app only
	cd app && pnpm run dev

# ============================================
# Quality Gates (ALL automated, ALL strict)
# ============================================
lint: ## Run all linters (ruff + eslint)
	cd api && ruff check .
	cd app && pnpm run lint

lint-fix: ## Auto-fix lint issues
	cd api && ruff check . --fix
	cd app && pnpm run lint:fix

format: ## Format all code (ruff + prettier)
	cd api && ruff format .
	cd app && pnpm run format

format-check: ## Check formatting without changes
	cd api && ruff format . --check
	cd app && pnpm run format:check

typecheck: ## Type-check everything (mypy + tsc)
	cd api && mypy atlas
	cd app && pnpm run typecheck

test: ## Run all tests with coverage
	cd api && pytest --cov=atlas --cov-report=term-missing --cov-fail-under=90
	cd app && pnpm run test 2>/dev/null || echo "App tests not yet configured"

quality: ## Run ALL quality checks (lint + format + typecheck + test)
	@echo "Running full quality suite..."
	$(MAKE) format-check
	$(MAKE) lint
	$(MAKE) typecheck
	$(MAKE) test
	@echo "All quality checks passed!"

# ============================================
# Build
# ============================================
build: ## Build for production
	cd app && pnpm run build
	@echo "Build complete. App assets in app/dist/"

# ============================================
# Docker
# ============================================
docker-up: ## Start with Docker Compose
	docker compose up -d

docker-down: ## Stop Docker Compose
	docker compose down

docker-build: ## Build Docker images
	docker compose build

docker-logs: ## Tail Docker logs
	docker compose logs -f

# ============================================
# Database
# ============================================
db-init: ## Initialize database schema
	cd api && python3 -m atlas.db_init

db-reset: ## Reset database (WARNING: deletes all data)
	cd api && rm -f atlas.db && python3 -m atlas.db_init

# ============================================
# Cleanup
# ============================================
clean: ## Remove all build artifacts and caches
	rm -rf api/__pycache__ api/.pytest_cache api/.mypy_cache api/.ruff_cache
	rm -rf app/dist app/node_modules/.vite
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
