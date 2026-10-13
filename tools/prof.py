"""Профиль кадра игры в headless Chrome: где тратится время (обновление мира, ИИ, свет, туман, HUD).

    python tools/prof.py                       # сцены fight и dark, 600 кадров подряд, программная отрисовка
    python tools/prof.py --raf --gpu           # настоящие кадры с выводом на экран и видеокартой: итог — кадров в секунду
    python tools/prof.py --n 1200 --size 2560x1440 --scene dark --skip drawFog

Время функций — включительное (вложенные вызовы входят в родителя), мс на кадр.
Без --raf кадры идут подряд без вывода на экран: Chrome копит команды отрисовки и выполняет их пачками,
поэтому медиана и пики обманчивы (растеризация многих кадров ложится на один) — смотрите среднее.
С --raf каждый кадр выводится, частота не ограничена: время кадра — полное (логика + растеризация + вывод).
"""
import argparse
import http.server
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from functools import partial
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_tests import find_chrome, free_port  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass


class Handler(http.server.SimpleHTTPRequestHandler):
    report = None

    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        Handler.report = json.loads(self.rfile.read(n).decode('utf-8'))
        self.send_response(200)
        self.end_headers()


def profile(chrome, port, scene, n, size, skip='', gpu=False, raf=False):
    w, h = size
    url = f'http://127.0.0.1:{port}/tools/prof.html?scene={scene}&n={n}&skip={skip}' + ('&raf=1' if raf else '')
    prof = tempfile.mkdtemp()
    Handler.report = None
    cmd = [chrome, '--headless=new', *([] if gpu else ['--disable-gpu']), f'--user-data-dir={prof}', '--no-proxy-server',
           '--disable-gpu-vsync', '--disable-frame-rate-limit', f'--window-size={w},{h}', url]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.time() + 600
        while Handler.report is None and time.time() < deadline and proc.poll() is None:
            time.sleep(0.3)
    finally:
        proc.kill()
        proc.wait()
        shutil.rmtree(prof, ignore_errors=True)
    return Handler.report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--n', type=int, default=600)
    ap.add_argument('--size', default='1920x1080')
    ap.add_argument('--scene', help='fight или dark (по умолчанию обе)')
    ap.add_argument('--skip', default='', help='через запятую: отключить функции (например drawFog)')
    ap.add_argument('--gpu', action='store_true', help='не отключать видеокарту (ближе к настоящему браузеру)')
    ap.add_argument('--raf', action='store_true', help='настоящие кадры с выводом на экран (итог — кадров в секунду)')
    a = ap.parse_args()
    size = tuple(int(v) for v in a.size.split('x'))
    chrome = find_chrome()
    port = free_port()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        for scene in [a.scene] if a.scene else ['fight', 'dark']:
            r = profile(chrome, port, scene, a.n, size, a.skip, a.gpu, a.raf)
            if not r:
                print(scene, ': нет результата (Chrome завис или страница не загрузилась)')
                continue
            if r.get('err'):
                print(scene, 'ошибка:', r['err'])
                continue
            fr = r['frame']
            fps = f", {r['fps']:.0f} кадров/с" if r.get('fps') else ''
            print(f"\n== {scene}: {r['w']}×{r['h']}, {r['n']} кадров{fps}; кадр avg {fr['avg']:.2f} мс, p50 {fr['p50']:.2f}, "
                  f"p95 {fr['p95']:.2f}, max {fr['max']:.1f}")
            print('   состояние:', r.get('state'))
            for name, v in sorted(r['fn'].items(), key=lambda kv: -kv[1]['ms']):
                if v['calls']:
                    print(f"   {name:18s} {v['ms'] / r['n']:7.3f} мс/кадр  {v['calls'] / r['n']:8.1f} вызовов/кадр  макс. {v['max']:6.2f} мс")
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
