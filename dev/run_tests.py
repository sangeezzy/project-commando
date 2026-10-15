"""Автотесты PROJECT COMMANDO (реалистичная версия) в headless Chrome.

Запуск из корня проекта:
    python dev/run_tests.py                 # все юнит-тесты
    python dev/run_tests.py --only m4,cover
    python dev/run_tests.py --only netlocal # только сеть: прямое подключение через server.ps1 / server.py (без интернета)

Chrome ищется в стандартных местах; путь можно задать переменной CHROME.
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
    'breach': 'bots=1',
    'kneel': '',
    'bots': 'bots=1',
    'firemove': '',
    'revive': 'bots=1',
    'voice': '',
    'netaddr': '',
    'allies': 'bots=1',
    'debug': '',
    'lookcam': '',
    'looktouch': 'touch=1',
    'aiwall': '',
    'aicorner': '',
    'aistack': '',
    'weapons': '',
    'maps': '',
    'armor': '',
    'weather': '',
    'survival': 'bots=1',
    'assault': 'bots=1',
    'execute': 'bots=1',
    'barks': '',
    'ff': 'bots=1',
    'pcmenu': '',
    'recoil': '',
    'touch': 'touch=1',
    'app': 'touch=1&app=1',
    'opts': 'touch=1',
    'guns': '',
    'mg': '',
    'squad8': '',
    'cars': '',
    'race': '',
    'renderopt': '',
    'offscreen': '',
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
    # Windows иногда резервирует части диапазона портов (WinError 10013) — пробуем несколько раз и в другом диапазоне
    import random
    for attempt in range(40):
        try:
            with socket.socket() as s:
                s.bind(('127.0.0.1', 0 if attempt < 5 else random.randint(20000, 45000)))
                return s.getsockname()[1]
        except OSError:
            time.sleep(0.1)
    raise OSError('не удалось найти свободный порт')


def java_server(port, rep=None):
    """Сервер приложения для телефона (dev/android/.../GameServer.java) на ПК: та же JDK, что для сборки .apk.
    Нет JDK (python dev/android/setup.py) — None, тесты этого сервера пропускаются."""
    sys.path.insert(0, str(ROOT / 'dev' / 'android'))
    try:
        from setup import TOOLS, jdk_home
    except ImportError:
        return None
    jdk = jdk_home()
    if not jdk:
        return None
    out = TOOLS / 'srvtest'
    src = ROOT / 'dev' / 'android' / 'app' / 'src' / 'com' / 'projectcommando' / 'game' / 'GameServer.java'
    cls = out / 'com' / 'projectcommando' / 'game' / 'GameServer.class'
    if not cls.exists() or cls.stat().st_mtime < src.stat().st_mtime:
        out.mkdir(parents=True, exist_ok=True)
        subprocess.run([str(jdk / 'bin' / 'javac.exe'), '-encoding', 'UTF-8', '-d', str(out), str(src)], check=True)
    cmd = [str(jdk / 'bin' / 'java.exe'), '-cp', str(out), 'com.projectcommando.game.GameServer', '--port', str(port),
           '--root', str(ROOT / 'game'), '--dev', str(ROOT / 'dev')]
    return cmd + (['--report', str(rep)] if rep else [])


SERVER_NAMES = {'py': 'server.py', 'ps1': 'server.ps1 (без Python)', 'java': 'GameServer.java (сервер телефона)'}


def run_srvrst(server='py'):
    """Сервер не перестаёт пускать игроков после клиентов, оборвавших соединение сбросом (RST) ещё до приёма.
    Так делают браузеры с лишними заранее открытыми соединениями; у asyncio на Windows (Proactor) первая такая
    ошибка закрывала слушающий сокет — server.py переставал принимать новых до перезапуска."""
    import struct
    import urllib.request
    print('\n[srvrst] ' + SERVER_NAMES[server] + ': 300 оборванных соединений')
    port = free_port()
    if server == 'py':
        cmd = [sys.executable, str(ROOT / 'server' / 'server.py'), str(port), '--dev']
    elif server == 'java':
        cmd = java_server(port)
    else:
        cmd = ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(ROOT / 'server' / 'server.ps1'), '-Port', str(port), '-Dev']
    srv = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))      # мимо системного прокси

    def ok():
        try:
            with direct.open(f'http://127.0.0.1:{port}/index.html', timeout=3) as r:
                return r.status == 200
        except Exception:  # noqa: BLE001
            return False
    try:
        deadline = time.time() + 40                  # server.ps1 компилирует C# при запуске
        while time.time() < deadline and not ok():
            time.sleep(0.3)
        Report.check('сервер запущен и отдаёт игру', ok())
        dead = None
        for i in range(300):
            sk = socket.socket()
            sk.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))   # закрыть сбросом
            try:
                sk.connect(('127.0.0.1', port))
            except OSError:
                pass
            sk.close()
            if i % 25 == 24 and not ok():
                dead = i + 1
                break
        Report.check('после 300 оборванных соединений принимает новых', dead is None and ok(), dead and f'перестал после {dead}')
    finally:
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(srv.pid)], capture_output=True) if sys.platform == 'win32' else srv.kill()


def run_netlocal(chrome, server='py', lag=0, jitter=0):
    """Прямое подключение: сервер хоста (server.py или server.ps1 — без Python), хост и 2 гостя через WebSocket. Интернет не нужен.
    lag/jitter (мс, только server.py) — помехи как в сети через VPN: каждое сообщение от сервера позже на lag ± jitter."""
    title = SERVER_NAMES[server] + (f', помехи {lag}±{jitter} мс в одну сторону' if lag or jitter else '')
    print(f'\n[netlocal] прямое подключение, {title}: хост + 2 гостя (около 30 с)')
    port = free_port()
    tmp = Path(tempfile.mkdtemp())
    rep = tmp / 'report.json'
    if server == 'py':
        cmd_srv = [sys.executable, str(ROOT / 'server' / 'server.py'), str(port), '--dev', '--report', str(rep), '--lag', str(lag), '--jitter', str(jitter)]
    elif server == 'java':
        cmd_srv = java_server(port, rep)
    else:
        cmd_srv = ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(ROOT / 'server' / 'server.ps1'), '-Port', str(port), '-Report', str(rep), '-Dev']
    diag = ''
    srv_log = open(tmp / 'server.log', 'wb')          # вывод сервера: при сбое прогона печатается хвост
    env = dict(os.environ, PYTHONUNBUFFERED='1', PYTHONIOENCODING='utf-8')
    srv = subprocess.Popen(cmd_srv, stdout=srv_log, stderr=subprocess.STDOUT, env=env)
    base = f'http://127.0.0.1:{port}'
    # сервер на PowerShell компилирует C# при запуске — подождать, пока начнёт отвечать
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=1):
                break
        except OSError:
            time.sleep(0.5)
    prof = tempfile.mkdtemp()
    cmd = [chrome, '--headless=new', '--disable-gpu', f'--user-data-dir={prof}', '--remote-debugging-port=0',
           '--autoplay-policy=no-user-gesture-required', '--window-size=1800,1100', '--no-proxy-server',
           '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',   # «микрофон» для голосового чата
           f'{base}/dev/net.html?lag={lag}&jitter={jitter}']
    chrome_log = open(tmp / 'chrome.log', 'wb')         # журнал Chrome: падения процессов страниц
    proc = subprocess.Popen(cmd + ['--enable-logging=stderr', '--v=0'], stdout=subprocess.DEVNULL, stderr=chrome_log)
    r = None
    try:
        t0 = time.time()
        deadline = t0 + 150
        last_mtime, last_rep = 0, t0          # когда страница в последний раз прислала отчёт (раз в 3 с)
        while time.time() < deadline:
            time.sleep(1)
            try:
                m = rep.stat().st_mtime
                if m != last_mtime:
                    last_mtime, last_rep = m, time.time()
                r = json.loads(rep.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                continue
            if r.get('final'):
                break
        if not r or not r.get('final'):
            # сбой: что именно встало — страница (браузер), сервер или просто не уложились по времени
            alive = proc.poll() is None
            import urllib.request
            direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))     # мимо системного прокси
            try:
                with direct.open(f'http://127.0.0.1:{port}/index.html', timeout=3) as resp:
                    srv_ok = f'да ({resp.status})'
            except Exception as e:  # noqa: BLE001
                srv_ok = f'нет ({type(e).__name__} {getattr(e, "code", "")})'
            # жив ли JavaScript страницы: она раз в секунду пишет в заголовок счётчик и последнюю проверку (через отладочный порт Chrome)
            titles = []
            try:
                dport = (Path(prof) / 'DevToolsActivePort').read_text().split()[0]
                for _ in range(2):
                    with direct.open(f'http://127.0.0.1:{dport}/json', timeout=3) as resp:
                        titles.append([t.get('title', '') for t in json.loads(resp.read()) if 'net.html' in t.get('url', '')])
                    time.sleep(2)
            except Exception as e:  # noqa: BLE001
                titles.append(f'нет ({type(e).__name__})')
            diag = (f'  --- сбой: прошло {time.time() - t0:.0f} с, последний отчёт страницы {time.time() - last_rep:.0f} с назад, '
                    f'Chrome жив: {"да" if alive else "нет"}, сервер отвечает: {srv_ok}' + '\n'
                    f'  --- заголовок страницы (через 2 с): {titles}')
    finally:
        proc.kill()
        srv.kill()
        if server == 'ps1':
            subprocess.run(['taskkill', '/F', '/T', '/PID', str(srv.pid)], capture_output=True)
        shutil.rmtree(prof, ignore_errors=True)
    srv_log.close()
    chrome_log.close()
    failed0 = Report.failed
    if not r or 'checks' not in r:
        Report.check('отчёт получен', False, r)
    else:
        for c in r['checks']:
            Report.check(c['name'], c['ok'], c.get('got'))
        Report.check('финальная фаза дошла до конца', bool(r.get('final')), r.get('log'))
    if Report.failed > failed0:
        if diag:
            print(diag)
        try:
            clog = (tmp / 'chrome.log').read_bytes().decode('utf-8', 'replace').splitlines()
            bad = [ln for ln in clog if re.search(r'crash|terminat|OOM|out of memory|killed|hung|unresponsive', ln, re.I)][-8:]
            for ln in bad:
                print('  ! chrome: ' + ln[:220])
        except OSError:
            pass
        tail = (tmp / 'server.log').read_bytes().decode('utf-8', 'replace').strip().splitlines()[-25:]
        print('  --- журнал сервера (хвост) ---')
        for ln in tail:
            print('  | ' + ln)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', help='через запятую: имена юнит-тестов (netlocal — сеть)')
    args = ap.parse_args()
    chrome = find_chrome()
    names = args.only.split(',') if args.only else list(UNIT_TESTS)
    netlocal = 'netlocal' in names or not args.only
    netjava = netlocal or 'netjava' in names            # netjava — только сервер телефона (GameServer.java)
    names = [n for n in names if n not in ('netlocal', 'netjava')]
    run_unit(chrome, names)
    if netlocal:
        run_srvrst('py')
        run_srvrst('ps1')
        run_netlocal(chrome, 'ps1')
        run_netlocal(chrome, 'py')
        run_netlocal(chrome, 'py', lag=60, jitter=20)     # как через VPN с большим пингом: ~120 мс
    if netjava:
        if java_server(0):                                # сервер телефона (нужна JDK: dev/android/setup.py)
            run_srvrst('java')
            run_netlocal(chrome, 'java')
        else:
            print('\n[netlocal] сервер телефона (Java) пропущен: нет JDK — python dev/android/setup.py --accept-licenses')
    print(f'\nИтого: {Report.total - Report.failed}/{Report.total} проверок прошло')
    sys.exit(1 if Report.failed else 0)


if __name__ == '__main__':
    main()
