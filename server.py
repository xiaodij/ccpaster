#!/usr/bin/env python3
"""Simple HTTP server with IP-based rate limiting for claudypasta."""

import http.server
import os
import time
import threading
import urllib.parse
from pathlib import Path
from collections import defaultdict

PORT = int(os.environ.get("PORT", "8032"))
STATIC_DIR = Path(__file__).parent / "static"

# Rate limiting: max requests per IP within the window
RATE_LIMIT = int(os.environ.get("RATE_LIMIT", "60"))  # requests
RATE_WINDOW = int(os.environ.get("RATE_WINDOW", "60"))  # seconds

# Track requests per IP: {ip: [timestamp, timestamp, ...]}
_rate_lock = threading.Lock()
_rate_map = defaultdict(list)


def _check_rate(ip):
    """Returns True if the request is allowed, False if rate-limited."""
    now = time.monotonic()
    cutoff = now - RATE_WINDOW
    with _rate_lock:
        # Prune old entries
        timestamps = _rate_map[ip]
        _rate_map[ip] = [t for t in timestamps if t > cutoff]
        if len(_rate_map[ip]) >= RATE_LIMIT:
            return False
        _rate_map[ip].append(now)
        return True


def _cleanup_stale():
    """Periodically remove IPs with no recent requests."""
    cutoff = time.monotonic() - RATE_WINDOW * 2
    with _rate_lock:
        stale = [ip for ip, ts in _rate_map.items() if not ts or ts[-1] < cutoff]
        for ip in stale:
            del _rate_map[ip]
    threading.Timer(300, _cleanup_stale).start()


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _get_client_ip(self):
        # Cloudflare/proxy sets these headers
        return (
            self.headers.get("CF-Connecting-IP")
            or self.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            or self.client_address[0]
        )

    def _send_file(self, filepath, content_type):
        try:
            data = filepath.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=300")
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self.send_error(404)

    def _send_rate_limited(self):
        body = b"<h1>429 Too Many Requests</h1><p>Slow down. Try again in a minute.</p>"
        self.send_response(429)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Retry-After", str(RATE_WINDOW))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        ip = self._get_client_ip()
        if not _check_rate(ip):
            self._send_rate_limited()
            return

        path = urllib.parse.urlparse(self.path).path

        # Serve static files
        if path == "/" or path == "":
            path = "/index.html"

        filepath = STATIC_DIR / path.lstrip("/")
        # Security: prevent path traversal
        try:
            filepath = filepath.resolve()
            if not str(filepath).startswith(str(STATIC_DIR.resolve())):
                self.send_error(403)
                return
        except (ValueError, OSError):
            self.send_error(403)
            return

        ext = filepath.suffix.lower()
        content_types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css",
            ".js": "application/javascript",
            ".png": "image/png",
            ".ico": "image/x-icon",
            ".svg": "image/svg+xml",
            ".json": "application/json",
        }
        ct = content_types.get(ext, "application/octet-stream")
        self._send_file(filepath, ct)


def main():
    _cleanup_stale()
    server = http.server.HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"claudypasta running on http://0.0.0.0:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
