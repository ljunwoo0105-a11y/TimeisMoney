#!/usr/bin/env python3
"""Tiny dev server that disables caching so code edits show up immediately.

Run:  python devserver.py [port]   (default 8042)

For real hosting (Netlify / GitHub Pages) you don't need this — those send
sensible cache headers, and the service worker keeps the app fresh.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8042
    print(f"Serving Time is Money at http://localhost:{port}  (no-cache dev mode)")
    ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
