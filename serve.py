"""Tiny static file server with caching disabled (handy while developing).

Usage: python3 serve.py [port]
"""
import http.server
import os
import sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))  # serve the game folder wherever you run this from
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    try:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', port), NoCache)
    except OSError:
        print(f'Port {port} is already in use. Either the game is already running at http://localhost:{port}')
        print(f'or something else uses that port. Try another one:  python3 serve.py {port + 1}')
        sys.exit(1)
    print(f'Taipei Planner running at http://localhost:{port}  (Ctrl+C to stop)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
