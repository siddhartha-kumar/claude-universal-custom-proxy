# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.3.x   | :white_check_mark: |
| < 0.3   | :x:                |

Only the latest minor release line receives security fixes. Older versions
should upgrade.

## Reporting a Vulnerability

If you believe you've found a security vulnerability in `claude-model-proxy`,
please **do not open a public GitHub issue**. Instead:

1. Email the maintainer at **shivsiddhartha187@hotmail.com** with the subject
   line `SECURITY: claude-model-proxy`.
2. Include:
   - A description of the vulnerability and its impact.
   - Reproduction steps or a proof-of-concept (ideally a minimal failing
     test case against `test/proxy.test.mjs`).
   - The affected version(s) (output of `node -e "console.log(require('./package.json').version)"`).
   - Whether you have published the issue elsewhere.

You'll receive an acknowledgement within **5 business days**. We aim to:

- Confirm or refute the report within **10 business days**.
- Ship a fix for confirmed High/Critical severity reports within **30 days**.
- Publish a coordinated disclosure with credit to the reporter (unless you
  request otherwise).

## Threat Model

The proxy is designed to run on the loopback interface of a developer
workstation or a single-tenant server. It is **not** hardened for
internet-facing deployment without an additional reverse proxy that handles
TLS, authentication, and rate limiting.

In-scope threats:

- Credential leakage between providers (e.g. a forwarded request reaching the
  wrong upstream with the wrong key).
- Header smuggling that could bypass the configured `Authorization` /
  `x-api-key` rewriting.
- Path traversal or injection in `/v1/models/{id}` lookups.
- Resource exhaustion via oversized request bodies or SSE streams.
- Supply-chain risks in `archiver` / `dotenv` (the only runtime dependencies).

Out of scope:

- Vulnerabilities in upstream provider APIs themselves.
- Misconfiguration that exposes the proxy on `0.0.0.0` without a reverse
  proxy. Anyone running this on a public interface is responsible for adding
  appropriate authentication and TLS termination.

## Verification of Releases

- Every commit on `main` and `dev` is SSH-signed by the maintainer's
  ED25519 key.
- The MCPB bundle is reproducible: `npm run build:mcpb` against a clean
  checkout of a tagged commit produces a byte-identical zip.
- A SHA-256 checksum of each released `.mcpb` is published in
  [CHANGELOG.md](CHANGELOG.md).
