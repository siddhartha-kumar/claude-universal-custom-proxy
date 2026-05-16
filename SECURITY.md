# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting a Vulnerability

Report suspected vulnerabilities privately to the repository owner via a GitHub
security advisory or by emailing the maintainer. Please include reproduction
steps, affected versions, and the expected impact.

The maintainer will:

1. Acknowledge receipt within five business days.
2. Investigate and confirm the issue.
3. Publish a fix and a release tagged with the corrected version.
4. Credit the reporter in the release notes if requested.

## Scope

This project is the LLM gateway in this repository. Upstream provider security,
deployment topology security, and downstream client security are out of scope.

## Hardening Defaults

- Production mode refuses to start without gateway authentication.
- Provider secrets must be loaded from environment variables, not committed.
- Request payloads are size-limited and JSON-validated.
- Rate limiting and security headers are enabled by default.
- Provider URLs are SSRF-validated against private and loopback addresses.

## Disclosure Timeline

Embargoed disclosure is preferred. A coordinated release is typically within 30
days from triage unless complexity or upstream dependencies require longer.
