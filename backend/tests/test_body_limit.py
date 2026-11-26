"""Synthetic ASGI requests; no real network or medical records."""
import sys
from unittest.mock import MagicMock, patch

import pytest
import httpx
from fastapi import FastAPI, File, UploadFile
from fastapi.testclient import TestClient
from starlette import formparsers
from starlette.formparsers import MultiPartParser
from starlette.responses import JSONResponse
from core.body_limit import RequestBodyLimitMiddleware

@pytest.fixture(scope='module')
def api_app():
    # Defer application import until collection completes. Restore only our
    # optional ML stubs: rolling back the entire sys.modules map unloads newly
    # imported NumPy extensions, which cannot be imported twice in one process.
    if 'main' in sys.modules:
        return sys.modules['main'].app
    stubs = {name: MagicMock() for name in (
        'services.inference_service', 'services.mamba_service', 'api.mamba_inference'
    ) if name not in sys.modules}
    sys.modules.update(stubs)
    try:
        from main import app
        return app
    finally:
        for name, stub in stubs.items():
            if sys.modules.get(name) is stub:
                sys.modules.pop(name)

RAW_CAP = 52 * 1024 * 1024


@pytest.mark.parametrize("path", ["/api/v1/process-mri", "/api/v1/upload-vitals"])
def test_oversized_length_rejected_before_multipart_parser(path, api_app):
    calls = []
    original = MultiPartParser.parse

    async def parse(parser):
        calls.append(True)
        return await original(parser)

    with patch.object(MultiPartParser, "parse", parse):
        response = TestClient(api_app).post(path, files={"file": ("synthetic.npy", b"small")}, headers={"Content-Length": str(RAW_CAP + 1)})
    assert calls == []
    assert response.status_code == 413


def test_ordinary_unauthenticated_upload_still_rejected(api_app):
    response = TestClient(api_app).post("/api/v1/process-mri", files={"file": ("synthetic.npy", b"small")})
    assert response.status_code == 401


def test_health_still_available_without_authentication(api_app):
    response = TestClient(api_app).get("/health/live")
    assert response.status_code == 200


async def exercise(headers, chunks, limit=8, downstream=None):
    seen, sent, reads = [], [], []
    messages = iter(chunks)

    async def receive():
        reads.append(True)
        return next(messages)

    async def send(message):
        sent.append(message)

    async def consume(scope, receive, send):
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                break
            seen.append(message.get('body', b''))
            if not message.get('more_body', False):
                break
        await JSONResponse({'size': sum(map(len, seen))})(scope, receive, send)

    scope = {'type': 'http', 'method': 'POST', 'path': '/upload', 'headers': headers}
    await RequestBodyLimitMiddleware(downstream or consume, max_body_bytes=limit)(scope, receive, send)
    return seen, sent, reads


@pytest.mark.asyncio
@pytest.mark.parametrize('headers', [[], [(b'content-length', b'1')]])
async def test_streaming_budget_does_not_trust_missing_or_dishonest_length(headers):
    seen, sent, reads = await exercise(headers, [
        {'type': 'http.request', 'body': b'12345', 'more_body': True},
        {'type': 'http.request', 'body': b'6789', 'more_body': True},
        {'type': 'http.request', 'body': b'not-read', 'more_body': False},
    ])
    assert [x['status'] for x in sent if x['type'] == 'http.response.start'] == [413]
    assert seen == [b'12345']
    assert len(reads) == 2


@pytest.mark.asyncio
async def test_exact_boundary_is_forwarded_without_truncation():
    seen, sent, _ = await exercise([], [
        {'type': 'http.request', 'body': b'12345', 'more_body': True},
        {'type': 'http.request', 'body': b'678', 'more_body': False},
    ])
    assert seen == [b'12345', b'678']
    assert sent[0]['status'] == 200


@pytest.mark.asyncio
async def test_declared_oversize_calls_neither_app_nor_receive():
    async def forbidden(*args):
        pytest.fail('Oversized request reached downstream')
    _, sent, reads = await exercise([(b'content-length', b'9')], [], downstream=forbidden)
    assert sent[0]['status'] == 413 and reads == []


@pytest.mark.asyncio
async def test_parser_retry_cannot_read_more_after_limit():
    async def retrying_parser(scope, receive, send):
        for _ in range(2):
            with pytest.raises(formparsers.MultiPartException):
                await receive()
        await JSONResponse({'unexpected': 'success'})(scope, receive, send)
    _, sent, reads = await exercise([], [
        {'type': 'http.request', 'body': b'over-limit', 'more_body': True},
    ], downstream=retrying_parser)
    assert sent[0]['status'] == 413 and len(reads) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('headers', [
    [(b'content-length', b'-1')], [(b'content-length', b'+1')],
    [(b'content-length', b'1, 2')], [(b'content-length', b'NaN')],
    [(b'content-length', b'9' * 5000)],
    [(b'content-length', b'1'), (b'content-length', b'1')],
    [(b'content-length', b'1'), (b'transfer-encoding', b'chunked')],
])
async def test_invalid_or_ambiguous_length_rejected_without_read(headers):
    _, sent, reads = await exercise(headers, [{'type': 'http.request', 'body': b'x', 'more_body': False}])
    assert sent[0]['status'] == 400 and reads == []


@pytest.mark.asyncio
async def test_partial_multipart_tempfile_closed_on_stream_limit(monkeypatch):
    files = []
    original = formparsers.SpooledTemporaryFile
    def tracked_file(*args, **kwargs):
        file = original(*args, **kwargs)
        files.append(file)
        return file
    monkeypatch.setattr(formparsers, 'SpooledTemporaryFile', tracked_file)
    target = FastAPI()
    @target.post('/upload')
    async def upload(file: UploadFile = File(...)):
        return {'size': len(await file.read())}
    target.add_middleware(RequestBodyLimitMiddleware, max_body_bytes=1024)
    async def chunks():
        yield b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="synthetic.bin"\r\nContent-Type: application/octet-stream\r\n\r\n' + b'a' * 600
        yield b'b' * 600 + b'\r\n--boundary--\r\n'
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=target), base_url='http://local.invalid') as client:
        response = await client.post('/upload', content=chunks(), headers={'Content-Type': 'multipart/form-data; boundary=boundary'})
    assert response.status_code == 413
    assert files and all(file.closed for file in files)


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['websocket', 'lifespan'])
async def test_non_http_scopes_pass_through(kind):
    calls = []
    async def target(scope, receive, send):
        calls.append(scope['type'])
    async def unused():
        pytest.fail('Unexpected body read')
    await RequestBodyLimitMiddleware(target)({'type': kind}, unused, unused)
    assert calls == [kind]


@pytest.mark.asyncio
async def test_disconnect_is_not_converted_to_size_error():
    _, sent, reads = await exercise([], [{'type': 'http.disconnect'}])
    assert sent[0]['status'] == 200 and len(reads) == 1


@pytest.mark.asyncio
async def test_late_limit_aborts_without_second_response_status():
    sent = []
    async def send(message):
        sent.append(message)
    async def receive():
        return {'type': 'http.request', 'body': b'over-limit', 'more_body': False}
    async def target(scope, receive, send):
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await receive()
        await send({'type': 'http.response.body', 'body': b'unexpected'})
    with pytest.raises(formparsers.MultiPartException):
        await RequestBodyLimitMiddleware(target, max_body_bytes=8)({'type': 'http', 'headers': []}, receive, send)
    assert [x['status'] for x in sent if x['type'] == 'http.response.start'] == [200]
    assert not any(x['type'] == 'http.response.body' for x in sent)
