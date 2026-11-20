"""
OpenComp - Python Standard Library Local HTTP Server (Zero Dependencies)
Binds strictly to 127.0.0.1 (loopback interface only) for 100% offline air-gapped security.
Serves ES modules with application/javascript MIME type to prevent CORS file:// errors.
"""

import sys
import os
import json
import urllib.parse
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

DOC_ROOT = Path(__file__).resolve().parent
INFO_FILE = DOC_ROOT / ".server_info.json"
HOST = "127.0.0.1"
DEFAULT_PORT = int(os.environ.get("OPENCOMP_PORT", os.environ.get("PORT", "8080")))


class OpenCompRequestHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript; charset=utf-8",
        ".mjs": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".htm": "text/html; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".wasm": "application/wasm",
        ".exr": "image/x-exr",
        ".dpx": "image/x-dpx",
        ".cube": "text/plain; charset=utf-8",
        ".nk": "text/plain; charset=utf-8",
        ".comp": "application/json; charset=utf-8",
        ".opencomp": "application/json; charset=utf-8"
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DOC_ROOT), **kwargs)

    def do_GET(self):
        # Health check endpoint
        parsed = urllib.parse.urlparse(self.path)
        decoded_path = urllib.parse.unquote(parsed.path)
        if ".." in decoded_path or ".." in parsed.path:
            self.send_error(403, "Directory traversal blocked")
            return

        if parsed.path in ("/health", "/api/health"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            payload = json.dumps({
                "status": "ok",
                "app": "OpenComp",
                "version": "1.3.1",
                "host": HOST,
                "server": "python"
            }).encode("utf-8")
            self.wfile.write(payload)
            return

        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, format, *args):
        # Quiet standard output during production
        pass


def write_server_info(port):
    try:
        info = {
            "host": HOST,
            "port": port,
            "url": f"http://{HOST}:{port}/",
            "pid": os.getpid(),
            "server": "python"
        }
        with open(INFO_FILE, "w", encoding="utf-8") as f:
            json.dump(info, f, indent=2)
    except Exception as e:
        print(f"[WARN] Could not write server info: {e}")


def cleanup_server_info():
    try:
        if INFO_FILE.exists():
            INFO_FILE.unlink()
    except Exception:
        pass


def run_server(port=DEFAULT_PORT):
    import atexit
    atexit.register(cleanup_server_info)

    max_port = port + 20
    current_port = port

    while current_port <= max_port:
        try:
            server = ThreadingHTTPServer((HOST, current_port), OpenCompRequestHandler)
            url = f"http://{HOST}:{current_port}/"
            print("================================================================")
            print("   🎬 OpenComp - Professional VFX Compositing Workstation (Python HTTP Server)")
            print(f"   🚀 Local server successfully bound to: {url}")
            print("   🔒 Bound strictly to 127.0.0.1 (Loopback only - 100% Offline)")
            print("================================================================")
            write_server_info(current_port)
            server.serve_forever()
            break
        except OSError as e:
            if "address already in use" in str(e).lower() or e.errno in (48, 98, 10048):
                print(f"[INFO] Port {current_port} is in use, trying port {current_port + 1}...")
                current_port += 1
            else:
                print(f"❌ [ERROR] Could not start server: {e}")
                sys.exit(1)


if __name__ == "__main__":
    p = DEFAULT_PORT
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        p = int(sys.argv[1])
    run_server(p)
