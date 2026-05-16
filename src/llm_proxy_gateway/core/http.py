from __future__ import annotations

from urllib.parse import urljoin


def join_url(base_url: str, path: str) -> str:
    base = f"{base_url.rstrip('/')}/"
    return urljoin(base, path.lstrip("/"))
