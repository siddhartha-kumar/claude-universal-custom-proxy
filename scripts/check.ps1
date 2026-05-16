$ErrorActionPreference = "Stop"

ruff check .
ruff format --check .
black --check .
isort --check-only .
mypy src tests
pytest --cov=llm_proxy_gateway --cov-report=term-missing
