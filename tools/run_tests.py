"""Автотесты PROJECT COMMANDO (реалистичная версия) в headless Chrome.

Запуск из корня проекта:
    python tools/run_tests.py                 # все юнит-тесты
    python tools/run_tests.py --only m4,cover
    python tools/run_tests.py --net           # + сетевой тест: хост и 2 гостя через PeerJS (нужен интернет, ~40 с)

Chrome ищется в стандартных местах; путь можно задать переменной CHROME.
Если интернет идёт через прокси (HTTPS_PROXY/HTTP_PROXY), сетевой тест передаёт его в Chrome.
"""
import argparse
import html
import http.server
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent
# имя теста -> параметры запуска игры (что добавить к index.html?autotest=1&...)
UNIT_TESTS = {
    'smoke': '',
    'm4': '',
    'cover': '',
    'ai': '',
    'light': '',
    'npclamp': '',
    'menu': '',
    'anim': '',
    'move': '',
    'doors': '',
    'doorfire': '',
    'lean': '',
    'npcpeek': '',
    'squad': '',
    'kneel': '',
    'bots': 'bots=1',
    'firemove': '',
    'revive': 'bots=1',
}

try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass


def find_chrome():
    env = os.environ.get('CHROME')
    if env and Path(env).exists():
        return env
    candidates = [
        r'C:\Program Files\Google\Chrome\Application\chrome.exe',
        r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
        r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    for name in ('google-chrome', 'chromium', 'chromium-browser', 'chrome'):
        p = shutil.which(name)
        if p:
            return p
    sys.exit('Chrome не найден. Укажите путь в переменной CHROME.')


def dump_dom(chrome, url, budget_ms, timeout_s):
    """Открыть страницу headless, промотать виртуальное время и вернуть JSON из 'RESULT ...'."""
    with tempfile.TemporaryDirectory() as prof:
        cmd = [chrome, '--headless=new', '--disable-gpu', '--allow-file-access-from-files',
               '--autoplay-policy=no-user-gesture-required', f'--user-data-dir={prof}',
               '--window-size=1200,800', f'--virtual-time-budget={budget_ms}', '--dump-dom', url]
        try:
            out = subprocess.run(cmd, capture_output=True, timeout=timeout_s).stdout.decode('utf-8', 'replace')
        except subprocess.TimeoutExpired:
            return None
    m = re.search(r'RESULT (.*?)</pre>', out, re.S)
    return json.loads(html.unescape(m.group(1))) if m else None


class Report:
    total = 0
    failed = 0

    @classmethod
    def check(cls, name, ok, got=None):
        cls.total += 1
        if not ok:
            cls.failed += 1
        mark = 'PASS' if ok else 'FAIL'
        detail = '' if got is None else f'  [{json.dumps(got, ensure_ascii=False)[:600]}]'
        print(f'  {mark}  {name}{detail if (not ok or got is not None) else ""}')


def run_unit(chrome, names):
    from urllib.parse import quote
    for name in names:
        print(f'\n[unit] {name}')
        url = (TOOLS / 'unit.html').as_uri() + f'?test={name}&q={quote(UNIT_TESTS.get(name, ""))}'
        res = dump_dom(chrome, url, 20000, 180)
        if res is None:
            Report.check('тест выполнился', False, 'нет результата (ошибка загрузки или таймаут)')
            continue
        for c in res:
            Report.check(c['name'], c['ok'], c.get('got'))


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def run_net(chrome):
    print('\n[net] хост + 2 гостя через PeerJS (около 40 с реального времени)')
    reports = {}

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(ROOT), **kw)

        def log_message(self, *a):
            pass

        def do_POST(self):
            data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            try:
                rep = json.loads(data)
                if rep.get('final') or not reports.get('last', {}).get('final'):
                    reports['last'] = rep
            except ValueError:
                pass
            self.send_response(200)
            self.end_headers()

    port = free_port()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    prof = tempfile.mkdtemp()
    cmd = [chrome, '--headless=new', '--disable-gpu', f'--user-data-dir={prof}', '--remote-debugging-port=0',
           '--disable-features=WebRtcHideLocalIpsWithMdns',  # без этого WebRTC в headless не соединяется
           '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',   # «микрофон» для голосового чата
           '--autoplay-policy=no-user-gesture-required',
           '--window-size=1800,1100']
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
    if proxy:
        cmd += [f'--proxy-server={proxy}', '--proxy-bypass-list=127.0.0.1;localhost']
    cmd.append(f'http://127.0.0.1:{port}/tools/net.html')
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.time() + 90
        while time.time() < deadline and not reports.get('last', {}).get('final'):
            time.sleep(1)
    finally:
        proc.kill()
        server.shutdown()
        shutil.rmtree(prof, ignore_errors=True)

    r = reports.get('last')
    if not r or 'checks' not in r:
        Report.check('отчёт получен', False, r)
        return
    for c in r['checks']:
        Report.check(c['name'], c['ok'], c.get('got'))
    Report.check('финальная фаза дошла до конца', bool(r.get('final')), r.get('log'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', help='через запятую: имена юнит-тестов (net — только сетевой)')
    ap.add_argument('--net', action='store_true', help='добавить сетевой тест (интернет: сигнальный сервер PeerJS)')
    args = ap.parse_args()
    chrome = find_chrome()
    names = args.only.split(',') if args.only else list(UNIT_TESTS)
    if 'net' in names:
        names.remove('net')
        args.net = True
    run_unit(chrome, names)
    if args.net:
        run_net(chrome)
    print(f'\nИтого: {Report.total - Report.failed}/{Report.total} проверок прошло')
    sys.exit(1 if Report.failed else 0)


if __name__ == '__main__':
    main()
