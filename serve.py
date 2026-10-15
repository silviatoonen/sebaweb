"""Local test server for the Sterrenstrijd / SeBa website.

Run it from the folder that contains index.html and simulator.html:

    python3 serve.py

Then open http://localhost:8000/ in your browser.
Unlike `python3 -m http.server`, this one tells the browser never to keep
a copy of a page, so you always see the files as they are on disk.
Stop it with Ctrl+C.
"""
import http.server
import socketserver

PORT = 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), NoCacheHandler) as server:
    print(f"Serving this folder at http://localhost:{PORT}/  (Ctrl+C to stop)")
    server.serve_forever()
