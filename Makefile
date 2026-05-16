.PHONY: install install-dev format lint type test coverage security run docker-build

PYTHON ?= python

install:
	$(PYTHON) -m pip install -e .

install-dev:
	$(PYTHON) -m pip install -e ".[dev]"

format:
	ruff format .
	black .
	isort .

lint:
	ruff check .
	ruff format --check .
	black --check .
	isort --check-only .

type:
	mypy src tests

test:
	pytest

coverage:
	pytest --cov=llm_proxy_gateway --cov-report=term-missing --cov-report=xml

security:
	bandit -r src
	pip-audit

run:
	uvicorn llm_proxy_gateway.main:app --host 0.0.0.0 --port 8080

docker-build:
	docker build -f docker/Dockerfile -t openai-compatible-llm-gateway:latest .
