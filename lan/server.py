"""Private LAN snapshot server. Python 3.9+, no third-party dependencies."""
import argparse
import copy
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import secrets
import socket
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

MAX_BYTES = 12 * 1024 * 1024


def validate_snapshot(value):
    if not isinstance(value, dict) or set(value) != {'data', 'progress'}:
        raise ValueError('invalid snapshot')
    for key in ('data', 'progress'):
        if not isinstance(value[key], str):
            raise ValueError('missing storage data')
    data = json.loads(value['data'])
    progress = json.loads(value['progress'])
    if not isinstance(data, dict) or not isinstance(data.get('records'), dict) or not isinstance(data.get('history'), list) or not isinstance(data.get('marks'), list):
        raise ValueError('invalid practice data')
    if not isinstance(progress, dict) or progress.get('version') != 1 or not isinstance(progress.get('sessions'), dict) or progress.get('subjectId') not in progress['sessions']:
        raise ValueError('invalid progress')
    return copy.deepcopy(value)


class Store:
    def __init__(self, path, bank_id):
        self.path, self.bank_id = Path(path), bank_id
        self.lock = threading.Lock()
        if self.path.exists():
            self.state = json.loads(self.path.read_text(encoding='utf-8'))
            if self.state.get('bankId') != bank_id:
                raise ValueError('题库版本已变化。请先备份旧同步数据，再换一个 --data 文件启动。')
            if self.state.get('snapshot') is not None:
                validate_snapshot(self.state['snapshot'])
            self.state['writer'] = None
            self.state['revision'] += 1
        else:
            self.state = {'serverId': secrets.token_hex(16), 'token': f'{secrets.randbelow(100000000):08}',
                          'bankId': bank_id, 'revision': 0, 'writer': None, 'snapshot': None, 'updatedAt': None}
        self.persist()

    def persist(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix('.tmp')
        tmp.write_text(json.dumps(self.state, ensure_ascii=False), encoding='utf-8')
        os.replace(tmp, self.path)

    def public(self):
        return {k: copy.deepcopy(v) for k, v in self.state.items() if k != 'token'}

    def change(self, action, body):
        with self.lock:
            if body.get('bankId') != self.bank_id:
                return 422, {'error': '题库版本不一致，请使用同步包中的网页'}
            client = body.get('clientId')
            if not isinstance(client, str) or not 8 <= len(client) <= 128:
                return 400, {'error': '设备编号无效'}
            if body.get('revision') != self.state['revision']:
                return 409, {'error': '共享进度已变化，请重新读取后再操作', **self.public()}
            if action == 'save' and self.state['writer'] != client:
                return 409, {'error': '另一台设备已接管，请先获取最新进度', **self.public()}
            if action not in ('save', 'claim', 'release'):
                return 404, {'error': 'unknown action'}
            if action == 'release' and self.state['writer'] != client:
                return 409, {'error': '本机不是当前答题设备', **self.public()}
            new_snapshot = body.get('snapshot')
            if action == 'save' and new_snapshot is None:
                return 400, {'error': '缺少记录'}
            if new_snapshot is not None:
                try:
                    new_snapshot = validate_snapshot(new_snapshot)
                except (ValueError, TypeError):
                    return 400, {'error': '记录格式无效'}
            # The previous complete snapshot remains recoverable on disk.
            previous = copy.deepcopy(self.state)
            if new_snapshot is not None:
                backup = self.path.with_suffix('.previous.json')
                backup.write_text(json.dumps(previous, ensure_ascii=False), encoding='utf-8')
                if action == 'claim' and previous['snapshot'] is not None:
                    archive = self.path.parent / 'backups'
                    archive.mkdir(exist_ok=True)
                    name = time.strftime('%Y%m%d-%H%M%S', time.gmtime()) + '-' + secrets.token_hex(4) + '.json'
                    (archive / name).write_text(json.dumps(previous, ensure_ascii=False), encoding='utf-8')
                self.state['snapshot'] = new_snapshot
            self.state['writer'] = None if action == 'release' else client
            self.state['revision'] += 1
            self.state['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            try:
                self.persist()
            except OSError:
                self.state = previous
                raise
            return 200, self.public()


def make_handler(store, dist):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(dist), **kwargs)

        def log_message(self, fmt, *args):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "frame-ancestors 'none'")
            super().end_headers()

        def reply(self, status, body):
            payload = json.dumps(body, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def safe_host(self):
            host = urlsplit('http://' + self.headers.get('Host', '')).hostname
            if host == 'localhost':
                return True
            try:
                address = ipaddress.ip_address(host)
                return address.is_private or address.is_loopback
            except ValueError:
                return False

        def authorized(self):
            return secrets.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + store.state['token'])

        def do_GET(self):
            if not self.safe_host():
                return self.reply(403, {'error': '请使用电脑的局域网 IP 地址访问'})
            route = urlsplit(self.path).path
            if route == '/api/info':
                return self.reply(200, {'serverId': store.state['serverId'], 'bankId': store.bank_id})
            if route.startswith('/api/'):
                if not self.authorized():
                    return self.reply(401, {'error': '配对码不正确'})
                if route != '/api/state':
                    return self.reply(404, {'error': 'not found'})
                with store.lock:
                    return self.reply(200, store.public())
            # Never serve listings, symlinks or files outside the shipped web app.
            resolved = Path(self.translate_path(route)).resolve()
            if not resolved.is_relative_to(Path(dist).resolve()) or (resolved.is_dir() and not (resolved / 'index.html').is_file()):
                return self.reply(404, {'error': 'not found'})
            super().do_GET()

        def do_POST(self):
            if not self.safe_host() or not self.authorized():
                return self.reply(401, {'error': '请重新配对'})
            origin = self.headers.get('Origin')
            if origin and origin != 'http://' + self.headers.get('Host', ''):
                return self.reply(403, {'error': '请求来源不匹配'})
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                return self.reply(415, {'error': '需要 JSON 请求'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= MAX_BYTES:
                    return self.reply(413, {'error': '记录大小超出限制'})
                self.connection.settimeout(10)
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    raise ValueError()
                action = urlsplit(self.path).path.removeprefix('/api/')
                status, result = store.change(action, body)
                return self.reply(status, result)
            except (ValueError, TypeError):
                return self.reply(400, {'error': '请求格式错误'})
            except OSError:
                return self.reply(503, {'error': '同步数据无法写入磁盘，请检查剩余空间和权限'})
    return Handler


def bank_fingerprint(dist):
    digest = hashlib.sha256()
    for name in ('questions.js', 'basic-theory.js', 'accounting-expanded.js', 'extra-subjects.js', 'strategy.js', 'question-numbers.js'):
        digest.update((Path(dist) / name).read_bytes())
    return digest.hexdigest()


def local_addresses():
    addresses = set()
    try:
        addresses.update(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
            # Route lookup only; no packet is sent and internet is not required.
            connection.connect(('192.0.2.1', 9))
            addresses.add(connection.getsockname()[0])
    except OSError:
        pass
    return sorted(a for a in addresses if not a.startswith('127.'))


def main():
    parser = argparse.ArgumentParser(description='CPA 局域网同步服务')
    root = Path(__file__).resolve().parent.parent
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--dist', type=Path, default=root / 'dist')
    parser.add_argument('--data', type=Path, default=root / 'lan-data' / 'sync.json')
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    store = Store(args.data, bank_fingerprint(args.dist))
    server = ThreadingHTTPServer(('0.0.0.0', args.port), make_handler(store, args.dist))
    server.daemon_threads = True
    print('\nCPA 局域网同步服务已启动', flush=True)
    print('配对码：' + store.state['token'], flush=True)
    print(f'电脑打开：http://127.0.0.1:{args.port}/', flush=True)
    for address in local_addresses():
        print(f'手机打开：http://{address}:{args.port}/', flush=True)
    print('两端输入同一个配对码。同步时请保持这个窗口打开。Ctrl+C 停止。\n', flush=True)
    if not args.no_browser:
        webbrowser.open(f'http://127.0.0.1:{args.port}/')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
