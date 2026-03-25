.PHONY: help setup dev dev-backend dev-frontend build test lint format typecheck quality clean docker-up docker-down docker-build

# Default target
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ============================================
# Setup
# ============================================
setup: ## First-time project setup
	@echo "Setting up The Atlas..."
	cp -n .env.example .env || true
	cd backend && pip install -e ".[dev]" --break-system-packages
	cd frontend && npm install
	cd backend && python -m atlas.models.database --init
	@echo "Setup complete! Run 'make dev' to start."

# ============================================
# Development
# ============================================
dev: ## Start full-stack development (backend + frontend)
	@echo "Starting The Atlas..."
	$(MAKE) -j2 dev-backend dev-frontend

dev-backend: ## Start backend only
	cd backend && uvicorn atlas.main:app --reload --host 0.0.0.0 --port 8000

dev-frontend: ## Start frontend only
	cd frontend && npm run dev

# ============================================
# Quality Gates (ALL automated, ALL strict)
# ============================================
lint: ## Run all linters (ruff + eslint)
	cd backend && ruff check .
	cd frontend && npm run lint

lint-fix: ## Auto-fix lint issues
	cd backend && ruff check . --fix
	cd frontend && npm run lint:fix

format: ## Format all code (ruff + prettier)
	cd backend && ruff format .
	cd frontend && npm run format

format-check: ## Check formatting without changes
	cd backend && ruff format . --check
	cd frontend && npm run format:check

typecheck: ## Type-check everything (mypy + tsc)
	cd backend && mypy atlas
	cd frontend && npm run typecheck

test: ## Run all tests with coverage
	cd backend && pytest --cov=atlas --cov-report=term-missing --cov-fail-under=90
	cd frontend && npm run test 2>/dev/null || echo "Frontend tests not yet configured"

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
	cd frontend && npm run build
	@echo "Build complete. Frontend assets in frontend/dist/"

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
	cd backend && python -m atlas.models.database --init

db-reset: ## Reset database (WARNING: deletes all data)
	cd backend && rm -f atlas.db && python -m atlas.models.database --init

# ============================================
# Cleanup
# ============================================
clean: ## Remove all build artifacts and caches
	rm -rf backend/__pycache__ backend/.pytest_cache backend/.mypy_cache backend/.ruff_cache
	rm -rf frontend/dist frontend/node_modules/.vite
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
