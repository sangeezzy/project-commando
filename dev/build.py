"""Сборка для раздачи: python dev/build.py → dist/ (index.html + game.js — все скрипты одним файлом, без комментариев).

В разработке сборка не нужна: игра — обычные файлы в game/. dist/ — то, что отдают игроку или кладут в приложение
(Capacitor и т. п.). Порядок скриптов берётся из game/index.html. --check — после сборки прогнать тест smoke на dist/.
"""
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAME = ROOT / 'game'
DIST = ROOT / 'dist'

try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass


def strip(src):
    # только целые строки-комментарии и пустые строки: код не трогаем (многострочных шаблонов с // в начале строки нет)
    out = [ln.rstrip() for ln in src.splitlines() if ln.strip() and not ln.lstrip().startswith('//')]
    return '\n'.join(out) + '\n'


def build():
    html = (GAME / 'index.html').read_text(encoding='utf-8')
    tags = re.findall(r'<script src="(js/[^"]+)"></script>\n?', html)
    if not tags:
        sys.exit('в game/index.html не найдено <script src="js/…">')
    parts = []
    for rel in tags:
        parts.append(f'// ---- {rel} ----\n' + strip((GAME / rel).read_text(encoding='utf-8')))
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    (DIST / 'game.js').write_text(''.join(parts), encoding='utf-8')
    first = True

    def one(m):
        nonlocal first
        if first:
            first = False
            return '<script src="game.js"></script>\n'
        return ''
    out = re.sub(r'<script src="js/[^"]+"></script>\n?', one, html)
    (DIST / 'index.html').write_text(out, encoding='utf-8')
    # прочие файлы игры (иконки, звуки и т. п.), кроме исходников js/
    for f in GAME.rglob('*'):
        if f.is_file() and f.name != 'index.html' and 'js' not in f.relative_to(GAME).parts:
            dst = DIST / f.relative_to(GAME)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dst)
    size = sum(f.stat().st_size for f in DIST.rglob('*') if f.is_file())
    print(f'dist/: {len(tags)} скриптов → game.js, всего {size // 1024} КБ')


def check():
    sys.path.insert(0, str(ROOT / 'dev'))
    import run_tests as rt
    url = (rt.TOOLS / 'unit.html').as_uri() + '?test=smoke&root=dist&q='
    res = rt.dump_dom(rt.find_chrome(), url, 20000, 180)
    if res is None:
        sys.exit('проверка: нет результата (ошибка загрузки или таймаут)')
    bad = [c for c in res if not c['ok']]
    for c in bad:
        print('  FAIL ', c['name'], c.get('got'))
    print(f'проверка dist/ (smoke): {len(res) - len(bad)}/{len(res)}')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    build()
    if '--check' in sys.argv:
        check()
