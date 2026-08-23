from core.rate_limit import process_mri_limiter


def test_competition_process_mri_rate_limit_policy():
    """Submission demo policy remains intentionally relaxed for live judging."""
    assert process_mri_limiter.requests == 50
    assert process_mri_limiter.window_seconds == 60
