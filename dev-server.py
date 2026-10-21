#!/usr/bin/env python3
"""Dev only: a static server that tells the browser never to cache, so a normal reload always
runs the newest modules. (python3 -m http.server lets browsers keep stale .js files.)
Usage: python3 dev-server.py [port]   (default 8000)"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Serving on http://localhost:{port}/ (no caching)")
    ThreadingHTTPServer(("", port), NoCache).serve_forever()
