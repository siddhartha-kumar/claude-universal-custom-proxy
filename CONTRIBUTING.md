# Contributing

Thank you for your interest in improving the OpenAI Compatible LLM Gateway.

See [`docs/contributing.md`](docs/contributing.md) for engineering expectations
and [`docs/branching-strategy.md`](docs/branching-strategy.md) for how branches
are organized.

## Quick Reference

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -e ".[dev]"
pre-commit install

make lint
make type
make coverage
make security
```

Open work against `dev`. Releases are cut from `main` using semantic version
tags such as `v0.1.0`.

## Submitting Changes

1. Open an issue describing the change for non-trivial work.
2. Create a topic branch from `dev`.
3. Add tests covering routing, providers, streaming, configuration, or error
   paths as appropriate.
4. Run the required checks above.
5. Open a pull request targeting `dev` and request review.

## Reporting Vulnerabilities

Please see [`SECURITY.md`](SECURITY.md) for the private disclosure process.
