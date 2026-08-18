import os
import uuid
import httpx
import base64
import json
import math
import time
import urllib.parse
from fastapi import Request, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

def normalize_origin(origin: str) -> str:
    if not origin:
        return ""
    origin = origin.strip()
    if not origin:
        return ""
    if origin == "*":
        return "*"

    try:
        if not origin.startswith(("http://", "https://")):
            return ""
        parsed = urllib.parse.urlparse(origin)
        if parsed.path not in ("", "/"):
            return ""
        if parsed.query or parsed.fragment:
            return ""

        if not parsed.hostname:
            return ""

        normalized = f"{parsed.scheme.lower()}://{parsed.hostname.lower()}"
        if parsed.port:
            normalized += f":{parsed.port}"
        return normalized
    except Exception:
        return ""

def get_allowed_origins(origins_str: str, app_env: str) -> list[str]:
    if not origins_str:
        return []
    allowed = []
    for o in origins_str.split(","):
        norm = normalize_origin(o)
        if norm:
            if norm == "*" and app_env == "production":
                continue
            allowed.append(norm)
    return allowed

class CurrentUser(BaseModel):
    user_id: str

security = HTTPBearer(auto_error=False)

async def get_current_user(request: Request, credentials: HTTPAuthorizationCredentials = Security(security)) -> CurrentUser:
    if not credentials:
        raise HTTPException(status_code=401, detail="Authentication credentials were not provided.")

    from core.rate_limit import auth_limiter, get_client_ip
    ip_key = f"ip:{get_client_ip(request)}"
    if not auth_limiter.is_allowed(ip_key):
        raise HTTPException(status_code=429, detail="Too Many Requests")

    token = credentials.credentials

    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not supabase_url:
        raise HTTPException(status_code=503, detail="Auth service configuration missing.")

    publishable_key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
    if not publishable_key:
        raise HTTPException(status_code=503, detail="Auth service configuration missing.")

    auth_url = f"{supabase_url}/auth/v1/user"

    headers = {
        "apikey": publishable_key,
        "Authorization": f"Bearer {token}"
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(auth_url, headers=headers, timeout=3.0)
    except httpx.TimeoutException:
        raise HTTPException(status_code=503, detail="Auth service timeout.")
    except httpx.RequestError:
        raise HTTPException(status_code=503, detail="Auth service is currently unavailable.")

    if response.status_code >= 500:
        raise HTTPException(status_code=503, detail="Auth service error.")
    elif response.status_code == 401 or response.status_code == 403:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    elif response.status_code != 200:
        raise HTTPException(status_code=401, detail="Authentication failed.")

    try:
        user_data = response.json()
        user_id = user_data.get("id")
        if not user_id:
            raise ValueError("No user ID found in response.")
        # Validate UUID
        valid_uuid = str(uuid.UUID(user_id))
        return CurrentUser(user_id=valid_uuid)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid user data received from Auth service.")

def decode_verified_token_exp(token: str) -> int | None:
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        payload_padding = parts[1] + "=" * (4 - len(parts[1]) % 4)
        jwt_payload = json.loads(base64.urlsafe_b64decode(payload_padding).decode("utf-8"))
        exp = jwt_payload.get("exp")
        if not isinstance(exp, (int, float)):
            return None
        if math.isnan(exp) or math.isinf(exp):
            return None
        if exp < int(time.time()):
            return None
        return int(exp)
    except Exception:
        return None
