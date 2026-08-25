"""Best-effort client IP resolution behind the bundled nginx reverse proxy.

``Request.client.host`` is the proxy's own bridge address for every request
in the supported Docker deployment (nginx -> backend), so anything that keys
per-caller state by IP (rate limiters, audit logs) needs the original address
nginx forwards instead. See ``frontend/nginx.conf`` for the headers it sets.
"""

from fastapi import Request


def client_ip(request: Request) -> str | None:
    """Preferring ``X-Forwarded-For``'s first hop, then ``X-Real-IP``, then
    the raw socket peer (direct, non-proxied deployments)."""
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        first_hop = forwarded_for.split(",")[0].strip()
        if first_hop:
            return first_hop
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else None
