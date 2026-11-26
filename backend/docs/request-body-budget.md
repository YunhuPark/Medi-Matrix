# Raw request body budget

The backend limits raw HTTP request bodies to52MiB before route/form parsing.
This permits the existing default50MiB imaging file plus2MiB of multipart
envelope. The cap applies even if an operator configures a larger per-file
`MAX_UPLOAD_SIZE`; application file/row/type limits still apply independently.
No environment variable or new service is required.

An oversized declared length returns413 without reading the body or invoking
the multipart parser. Invalid/duplicate length or length+transfer-encoding
ambiguity returns400. Missing or dishonest lengths are counted while streaming;
the chunk that crosses the budget is not forwarded and no second body copy is
buffered. Multipart exceptions close partial spooled files before the middleware
emits one413. An already-started downstream response is aborted on a late limit
rather than emitting a second status.

CORS wraps this guard so allowed frontend origins can read its error response.
CORS preflights can return without reading a body or invoking routes. WebSocket
and lifespan scopes, normal authentication,50MiB file limits, model flags and
cardnews/Render automation are unchanged. This is a per-request resource bound,
not a total concurrency, disk quota, slow-client timeout, or DDoS guarantee.

Tests use tiny synthetic ASGI chunks, including a partial multipart tempfile;
they do not allocate giant uploads, use real patient data, or call live services.
Run from `backend`: `python -m pytest tests/test_body_limit.py -q`.
