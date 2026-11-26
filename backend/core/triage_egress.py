"""Destination policy for the legacy, local-only triage simulator."""

LOCAL_TRIAGE_URL = "http://127.0.0.1:8001/api/triage/webhook"
_SUPPORTED_CONFIGURATIONS = {
    "",
    LOCAL_TRIAGE_URL,
    "http://localhost:8001/api/triage/webhook",
}


def local_triage_destination(configured: str | None) -> str:
    """Fail closed until a remote authenticated integration is reviewed.

    Exact configurations avoid URL-parser authority ambiguities. Always connect
    to the literal loopback address rather than resolving a hostname.
    """
    if configured is not None and configured not in _SUPPORTED_CONFIGURATIONS:
        raise ValueError("Unapproved triage destination")
    return LOCAL_TRIAGE_URL
