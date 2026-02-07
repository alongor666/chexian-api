#!/usr/bin/env python3
"""
本地测试服务器 - 模拟内网部署环境
支持 DuckDB-WASM 所需的 CORS 头
"""

import http.server
import socketserver
import os
import sys

PORT = 8080
DIST_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'dist')
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST_DIR, **kwargs)

    def end_headers(self):
        # DuckDB-WASM 必需的 CORS 头
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        super().end_headers()

    def do_GET(self):
        # 处理 /data/ 路径
        if self.path.startswith('/data/'):
            file_path = os.path.join(DATA_DIR, self.path[6:])
            if os.path.exists(file_path):
                self.send_response(200)
                self.send_header('Content-Type', 'application/octet-stream')
                self.send_header('Content-Length', os.path.getsize(file_path))
                self.end_headers()
                with open(file_path, 'rb') as f:
                    self.wfile.write(f.read())
                return
            else:
                self.send_error(404, f'File not found: {self.path}')
                return

        # SPA 路由支持
        if not os.path.exists(os.path.join(DIST_DIR, self.path.lstrip('/'))) and not '.' in self.path:
            self.path = '/index.html'

        super().do_GET()

if __name__ == '__main__':
    print(f'🚀 启动本地测试服务器...')
    print(f'📁 静态文件: {DIST_DIR}')
    print(f'📊 数据目录: {DATA_DIR}')
    print(f'')
    print(f'✅ 访问地址: http://localhost:{PORT}')
    print(f'')
    print(f'按 Ctrl+C 停止服务')

    with socketserver.TCPServer(("", PORT), CORSRequestHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n服务已停止')
