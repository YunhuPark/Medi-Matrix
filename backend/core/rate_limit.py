import time
from fastapi import Request, HTTPException
from collections import defaultdict
import threading
import os

def default_get_time():
    return time.monotonic()

class RateLimiter:
    def __init__(self, requests: int, window_seconds: int, get_time_func=None, max_entries: int = 10000):
        if requests <= 0 or window_seconds <= 0 or max_entries <= 0:
            raise ValueError("requests, window_seconds, and max_entries must be positive")
        self.requests = requests
        self.window_seconds = window_seconds
        self.history = defaultdict(list)
        self.lock = threading.Lock()
        self.max_entries = max_entries
        self.get_time = get_time_func or default_get_time

    def cleanup(self, now: float):
        keys_to_delete = []
        for key, timestamps in self.history.items():
            valid_timestamps = [t for t in timestamps if now - t < self.window_seconds]
            if valid_timestamps:
                self.history[key] = valid_timestamps
            else:
                keys_to_delete.append(key)
        for key in keys_to_delete:
            del self.history[key]

    def is_allowed(self, key: str) -> bool:
        with self.lock:
            now = self.get_time()
            if len(self.history) >= self.max_entries and key not in self.history:
                self.cleanup(now)
                if len(self.history) >= self.max_entries and key not in self.history:
                    return False
            
            timestamps = self.history.get(key, [])
            timestamps = [t for t in timestamps if now - t < self.window_seconds]
            self.history[key] = timestamps
            
            if len(timestamps) >= self.requests:
                return False
                
            self.history[key].append(now)
            return True

# Define limiters (Relaxed for demo/competition testing)
process_mri_limiter = RateLimiter(requests=50, window_seconds=60)
upload_vitals_limiter = RateLimiter(requests=100, window_seconds=60)
triage_send_limiter = RateLimiter(requests=30, window_seconds=60)
signed_url_limiter = RateLimiter(requests=30, window_seconds=60)
websocket_limiter = RateLimiter(requests=5, window_seconds=60)
auth_limiter = RateLimiter(requests=100, window_seconds=60)

def get_client_ip(request: Request) -> str:
    trust_proxy = os.environ.get("TRUST_PROXY_HEADERS", "").lower() == "true"
    if trust_proxy:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def check_rate_limit(request: Request, limiter: RateLimiter, user_id: str = None):
    ip = get_client_ip(request)
    
    ip_key = f"ip:{ip}"
    if not limiter.is_allowed(ip_key):
        raise HTTPException(
            status_code=429, 
            detail="Too Many Requests",
            headers={"Retry-After": str(limiter.window_seconds)}
        )
        
    if user_id:
        user_key = f"user:{user_id}"
        if not limiter.is_allowed(user_key):
            raise HTTPException(
                status_code=429, 
                detail="Too Many Requests",
                headers={"Retry-After": str(limiter.window_seconds)}
            )
