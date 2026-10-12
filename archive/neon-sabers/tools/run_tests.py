"""Автотесты NEON SABERS в headless Chrome.

Запуск из корня проекта:
    python tools/run_tests.py            # юнит-тесты механик + боты
    python tools/run_tests.py --net      # + сетевой тест (нужен интернет: сигнальный сервер PeerJS)
    python tools/run_tests.py --only noise,hub
    python tools/run_tests.py --no-bots

Chrome ищется в стандартных местах; путь можно задать переменной CHROME.
Если интернет идёт через прокси (HTTPS_PROXY/HTTP_PROXY), сетевой тест передаёт его в Chrome,
а localhost пускает напрямую.
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
UNIT_TESTS = ['noise', 'aim', 'saber', 'hum', 'darksight', 'visibility', 'hub']

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
        detail = '' if got is None else f'  [{json.dumps(got, ensure_ascii=False)}]'
        print(f'  {mark}  {name}{detail if (not ok or got is not None) else ""}')


def run_unit(chrome, names):
    for name in names:
        print(f'\n[unit] {name}')
        url = (TOOLS / 'unit.html').as_uri() + f'?test={name}'
        res = dump_dom(chrome, url, 6000, 90)
        if res is None:
            Report.check('тест выполнился', False, 'нет результата (ошибка загрузки?)')
            continue
        for c in res:
            Report.check(c['name'], c['ok'], c.get('got'))


def run_bots(chrome):
    expectations = {
        # контрабандист обычно проходит 2 миссии за минуту, джедай-бот слабее — от него ждём хотя бы вылет
        'smuggler': 2,
        'jedi': 1,
    }
    for cls, min_level in expectations.items():
        print(f'\n[bot] {cls} (60 с игрового времени)')
        url = (TOOLS / 'bot.html').as_uri() + f'?cls={cls}&t=60000'
        res = dump_dom(chrome, url, 65000, 300)
        if res is None:
            Report.check('бот отработал', False, 'нет результата')
            continue
        Report.check('без ошибок в консоли', not res['errors'], res['errors'] or None)
        Report.check(f'дошёл до миссии {min_level}+', max(res['levels'] or [0]) >= min_level,
                     {'levels': res['levels'], 'progress': res['progress'], 'deaths': res['deaths']})


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def run_net(chrome):
    print('\n[net] хост + гость через PeerJS (около 30 с реального времени)')
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
                # промежуточный отчёт, пришедший позже финального, не должен его затирать
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
           '--window-size=1700,1100']
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
    if proxy:
        cmd += [f'--proxy-server={proxy}', '--proxy-bypass-list=127.0.0.1;localhost']
    cmd.append(f'http://127.0.0.1:{port}/tools/net.html')
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.time() + 60
        while time.time() < deadline and not reports.get('last', {}).get('final'):
            time.sleep(1)
    finally:
        proc.kill()
        server.shutdown()
        shutil.rmtree(prof, ignore_errors=True)

    r = reports.get('last')
    if not r or 'host' not in r:
        Report.check('отчёт получен', False, r)
        return
    h, g = r['host'], r['guest']
    Report.check('гость подключился', h['net']['connected'] and g['net']['connected'],
                 {'log': r['log'], 'guestStatus': r.get('guestStatus')})
    Report.check('без ошибок в консоли', not h['errors'] and not g['errors'], h['errors'] + g['errors'] or None)
    Report.check('один и тот же уровень', h['lv'] == g['lv'], {'host': h['lv'], 'guest': g['lv']})
    Report.check('прогресс у гостя совпадает с хостом', h['progress'] == g['progress'], {'host': h['progress'], 'guest': g['progress']})
    Report.check('финальная фаза дошла до конца', bool(r.get('final')))
    expected = {'старт': [True] * 4, 'гость нажал F': [False, False, True, True],
                'хост нажал F': [False] * 4, 'оба снова F': [True] * 4}
    got = dict((step, state) for step, state in r.get('sab', []))
    for step, exp in expected.items():
        Report.check(f'меч синхронизирован: {step}', got.get(step) == exp, got.get(step))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--net', action='store_true', help='запустить сетевой тест')
    ap.add_argument('--no-bots', action='store_true', help='пропустить ботов')
    ap.add_argument('--only', help='через запятую: имена юнит-тестов')
    args = ap.parse_args()
    chrome = find_chrome()
    names = args.only.split(',') if args.only else UNIT_TESTS
    run_unit(chrome, names)
    if not args.no_bots and not args.only:
        run_bots(chrome)
    if args.net:
        run_net(chrome)
    print(f'\nИтого: {Report.total - Report.failed}/{Report.total} проверок прошло')
    sys.exit(1 if Report.failed else 0)


if __name__ == '__main__':
    main()
