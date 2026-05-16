# Contribution Standards

## Engineering Expectations

- Keep changes focused and reviewed against behavior, security, and operability.
- Add or update tests for routing, provider behavior, streaming, configuration, and error paths.
- Run formatting, linting, typing, tests, and security checks before merge.
- Do not commit `.env`, provider credentials, generated caches, or local runtime output.

## Commit Style

Use concise semantic commits:

- `feat: add provider route`
- `fix: handle upstream timeout`
- `docs: update deployment guide`
- `test: cover streaming cancellation`
- `chore: update tooling`

## Required Checks

```bash
make lint
make type
make coverage
make security
```
