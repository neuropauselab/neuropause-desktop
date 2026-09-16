#!/usr/bin/env python3
# Tiny host server: GET serves files from the script dir (lowercase names);
# PUT/POST saves the body into ./uploads/ so the guest can hand evidence back.
import http.server, os, socketserver
ROOT = os.path.dirname(os.path.abspath(__file__))
UP = os.path.join(ROOT, 'uploads'); os.makedirs(UP, exist_ok=True)

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)
    def do_PUT(self):
        n = int(self.headers.get('Content-Length', 0))
        name = os.path.basename(self.path)
        with open(os.path.join(UP, name), 'wb') as f:
            f.write(self.rfile.read(n))
        self.send_response(201); self.end_headers(); self.wfile.write(b'OK')
    do_POST = do_PUT

class TCP(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

TCP(('0.0.0.0', 8099), H).serve_forever()
