"""Shared CORS/origin policy for HTTP and WebSocket entry points."""

from __future__ import annotations

import os
import re

DEFAULT_DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

# Vercel creates both per-deployment hostnames and branch aliases for Preview.
# Keep matching scoped to this exact project/team instead of opening CORS with *.
DEFAULT_VERCEL_PREVIEW_ORIGIN_REGEX = (
    r"^https://medi-matrix-[a-z0-9-]+-park-yun-hus-projects\.vercel\.app$"
)


def build_cors_origins() -> list[str]:
    explicit = os.environ.get("ALLOWED_ORIGINS", "").strip()
    if explicit:
        return [
            origin.strip().rstrip("/")
            for origin in explicit.split(",")
            if origin.strip()
        ]

    if os.environ.get("APP_ENV", "development").lower() == "production":
        return []

    return DEFAULT_DEV_ORIGINS.copy()


def build_cors_origin_regex() -> str | None:
    explicit = os.environ.get("ALLOWED_ORIGIN_REGEX", "").strip()
    if explicit:
        return explicit

    if os.environ.get("APP_ENV", "development").lower() == "production":
        return DEFAULT_VERCEL_PREVIEW_ORIGIN_REGEX

    return None


def is_origin_allowed(origin: str | None) -> bool:
    """Return whether a browser Origin is allowed for HTTP/WS access."""
    if not origin:
        return False

    normalized = origin.strip().rstrip("/")
    if normalized in build_cors_origins():
        return True

    origin_regex = build_cors_origin_regex()
    return bool(origin_regex and re.fullmatch(origin_regex, normalized))
