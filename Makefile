.PHONY: help install dev build db-generate lint format check test test-unit test-http test-integration publish-local publish-npm clean

# ─── Help ─────────────────────────────────────────────────────────────────────

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ─── Development ──────────────────────────────────────────────────────────────

install: ## Install dependencies (yarn install)
	yarn install

dev: ## Watch mode via Yalc (publishes to local store on every change)
	yarn medusa plugin:develop

build: ## Compile plugin to .medusa/server/
	yarn medusa plugin:build

# ─── Database ─────────────────────────────────────────────────────────────────

db-generate: ## Generate migrations for the pennylane module (usage: make db-generate MOD=pennylane)
	yarn medusa plugin:db:generate $(MOD)

# ─── Quality ──────────────────────────────────────────────────────────────────

lint: ## Run ESLint with autofix
	yarn eslint . --fix

format: ## Run Prettier (write)
	yarn prettier --write .

check: ## Run lint + format check + type check (CI gate)
	yarn eslint .
	yarn prettier --check .
	yarn tsc --noEmit

# ─── Tests ────────────────────────────────────────────────────────────────────

test: test-unit test-http ## Run all tests (unit + HTTP integration)

test-unit: ## Run unit tests
	yarn test:unit

test-http: ## Run HTTP integration tests
	yarn test:integration:http

test-integration: ## Run module integration tests
	yarn test:integration:modules

# ─── Publishing ───────────────────────────────────────────────────────────────

publish-local: ## Publish to local Yalc store for host-app development
	yarn medusa plugin:publish

publish-npm: ## Build + publish to npm (CI only; manual triggers: use tag push)
	yarn medusa plugin:build
	npm publish --provenance --access public

# ─── Cleanup ──────────────────────────────────────────────────────────────────

clean: ## Remove build artifacts and cache
	rm -rf .medusa dist .cache
