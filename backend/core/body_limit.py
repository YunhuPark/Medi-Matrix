"""Raw HTTP body budget before route/form parsing."""
from starlette.responses import JSONResponse
from starlette.formparsers import MultiPartException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MAX_REQUEST_BODY_BYTES = 52 * 1024 * 1024


class _BodyTooLarge(MultiPartException):
    """Also asks older supported multipart parsers to close partial files."""


class RequestBodyLimitMiddleware:
    def __init__(self, app: ASGIApp, max_body_bytes: int = MAX_REQUEST_BODY_BYTES):
        if max_body_bytes <= 0:
            raise ValueError("Body budget must be positive")
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = scope.get("headers", [])
        lengths = [value for name, value in headers if name.lower() == b"content-length"]
        if lengths and (
            len(lengths) != 1 or not lengths[0].isdigit() or len(lengths[0]) > 20
            or any(name.lower() == b"transfer-encoding" for name, _ in headers)
        ):
            await JSONResponse({"detail": "Invalid request framing."}, status_code=400, headers={"Cache-Control": "no-store"})(scope, receive, send)
            return
        if lengths and int(lengths[0]) > self.max_body_bytes:
            await self._reject(scope, receive, send)
            return

        received = 0
        exceeded = False
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received, exceeded
            if exceeded:
                raise _BodyTooLarge("Request body too large.")
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_bytes:
                    exceeded = True
                    raise _BodyTooLarge("Request body too large.")
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal response_started
            # FastAPI may translate our parser exception into400. Replace it
            # once, after parser cleanup, rather than sending two responses.
            if not exceeded:
                if message["type"] == "http.response.start":
                    response_started = True
                await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except _BodyTooLarge:
            if not exceeded:
                raise
        if exceeded:
            if response_started:
                # An already-started response cannot be replaced with413.
                # Propagate so the ASGI server terminates the partial response.
                raise _BodyTooLarge("Request body too large.")
            await self._reject(scope, receive, send)

    async def _reject(self, scope: Scope, receive: Receive, send: Send) -> None:
        await JSONResponse({"detail": "Request body too large."}, status_code=413, headers={"Cache-Control": "no-store"})(scope, receive, send)
