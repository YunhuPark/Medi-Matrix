import time
from fastapi import Request, HTTPException
from collections import defaultdict
import threading

class RateLimiter:
    def __init__(self, requests: int, window_seconds: int):
        self.requests = requests
        self.window_seconds = window_seconds
        self.history = defaultdict(list)
        self.lock = threading.Lock()
        self.max_entries = 10000

    def cleanup(self):
        now = time.time()
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
            # Prevent unbounded memory growth
            if len(self.history) > self.max_entries:
                self.cleanup()
                
            now = time.time()
            timestamps = self.history.get(key, [])
            
            # Remove old requests for this key
            timestamps = [t for t in timestamps if now - t < self.window_seconds]
            self.history[key] = timestamps
            
            if len(timestamps) >= self.requests:
                return False
                
            self.history[key].append(now)
            return True

# Define limiters
process_mri_limiter = RateLimiter(requests=5, window_seconds=600)
upload_vitals_limiter = RateLimiter(requests=10, window_seconds=600)
triage_send_limiter = RateLimiter(requests=30, window_seconds=60)
signed_url_limiter = RateLimiter(requests=30, window_seconds=60)
websocket_limiter = RateLimiter(requests=5, window_seconds=60)

def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def check_rate_limit(request: Request, limiter: RateLimiter, user_id: str = None):
    ip = get_client_ip(request)
    key = f"{user_id}:{ip}" if user_id else ip
    
    if not limiter.is_allowed(key):
        raise HTTPException(
            status_code=429, 
            detail="Too Many Requests",
            headers={"Retry-After": str(limiter.window_seconds)}
        )
