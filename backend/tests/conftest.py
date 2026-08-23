import pytest


@pytest.fixture(autouse=True)
def isolate_rate_limit_enforcement_threshold(request):
    """Keep the legacy enforcement test fast without changing production policy.

    The competition demo currently allows 50 process-MRI requests per 60 seconds.
    `test_rate_limit_exceeded` is intended to verify that the router returns 429
    once *a configured threshold* is exhausted, so it uses a small threshold only
    for that test. Production configuration is asserted separately.
    """
    if request.node.name != "test_rate_limit_exceeded":
        yield
        return

    from core.rate_limit import process_mri_limiter

    original_requests = process_mri_limiter.requests
    original_window = process_mri_limiter.window_seconds
    process_mri_limiter.requests = 5
    process_mri_limiter.window_seconds = 60
    process_mri_limiter.history.clear()

    try:
        yield
    finally:
        process_mri_limiter.history.clear()
        process_mri_limiter.requests = original_requests
        process_mri_limiter.window_seconds = original_window
