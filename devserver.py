"""Local dev server for Fiona CAN cook that disables caching, so edits show up
on every reload. For production use a normal static host (see README)."""
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

os.chdir(os.path.dirname(os.path.abspath(__file__)))

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8142


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    print(f"Serving Fiona CAN cook (no-cache) at http://127.0.0.1:{PORT}")
    HTTPServer(("127.0.0.1", PORT), NoCacheHandler).serve_forever()
