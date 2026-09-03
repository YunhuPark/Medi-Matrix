import re

from core.cors_policy import (
    DEFAULT_VERCEL_PREVIEW_ORIGIN_REGEX,
    build_cors_origin_regex,
    build_cors_origins,
    is_origin_allowed,
)


def test_production_uses_scoped_vercel_preview_regex(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("ALLOWED_ORIGIN_REGEX", raising=False)

    origin_regex = build_cors_origin_regex()

    assert origin_regex == DEFAULT_VERCEL_PREVIEW_ORIGIN_REGEX
    assert re.fullmatch(
        origin_regex,
        "https://medi-matrix-1fz1j6ihb-park-yun-hus-projects.vercel.app",
    )
    assert re.fullmatch(
        origin_regex,
        "https://medi-matrix-git-ai-championship-20-fb627b-park-yun-hus-projects.vercel.app",
    )


def test_preview_regex_rejects_unrelated_origins(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("ALLOWED_ORIGIN_REGEX", raising=False)

    origin_regex = build_cors_origin_regex()

    assert not re.fullmatch(origin_regex, "https://evil-domain.example")
    assert not re.fullmatch(
        origin_regex,
        "https://medi-matrix-1fz1j6ihb-other-team.vercel.app",
    )
    assert not re.fullmatch(
        origin_regex,
        "https://medi-matrix-1fz1j6ihb-park-yun-hus-projects.vercel.app.evil.example",
    )


def test_explicit_origins_are_normalized(monkeypatch):
    monkeypatch.setenv(
        "ALLOWED_ORIGINS",
        " https://medi-matrix.vercel.app/, https://example.com ",
    )

    assert build_cors_origins() == [
        "https://medi-matrix.vercel.app",
        "https://example.com",
    ]


def test_explicit_origin_regex_overrides_default(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ALLOWED_ORIGIN_REGEX", r"^https://preview\.example\.com$")

    assert build_cors_origin_regex() == r"^https://preview\.example\.com$"


def test_websocket_origin_policy_accepts_same_preview_hosts(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    monkeypatch.delenv("ALLOWED_ORIGIN_REGEX", raising=False)

    assert is_origin_allowed(
        "https://medi-matrix-57ioceasz-park-yun-hus-projects.vercel.app"
    )
    assert is_origin_allowed(
        "https://medi-matrix-git-ai-championship-20-fb627b-park-yun-hus-projects.vercel.app"
    )
    assert not is_origin_allowed("https://evil-domain.example")
    assert not is_origin_allowed(None)
