"""Иконка игры без сторонних библиотек: прицельная сетка на тёмном фоне, PNG любого размера.

    python dev/android/icon.py        # game/icons/ (для браузера) и dev/android/app/res/ (для приложения)

Рисуется векторно (расстояния до фигур) с 4×4 выборками на пиксель — края сглажены.
"""
import math
import struct
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent

BG_TOP = (44, 48, 40)        # тёмно-оливковый
BG_BOT = (22, 23, 24)        # почти чёрный (фон игры #1b1c1d)
SAND = (232, 228, 216)       # цвет интерфейса
WARN = (255, 176, 48)        # акцент (HUD_WARN)


def png(path, w, h, pixels):
    """pixels — bytearray RGBA построчно"""
    raw = b''.join(b'\x00' + bytes(pixels[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + \
        chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def reticle(u, v):
    """Знак в координатах -1..1 (центр 0,0): цвет и покрытие или None"""
    r = math.hypot(u, v)
    # центральная точка
    if r < 0.075:
        return WARN
    # кольцо
    if abs(r - 0.56) < 0.055:
        # разрывы кольца по диагоналям — чтобы читалось как прицел, а не «бублик»
        a = math.atan2(v, u) % (math.pi / 2)
        if abs(a - math.pi / 4) > 0.2:
            return SAND
    # штрихи по осям: снаружи кольца внутрь
    for a, b in ((u, v), (v, u)):
        if abs(b) < 0.045 and 0.22 < abs(a) < 0.86:
            return SAND
    return None


def draw(size, kind):
    """kind: 'full' — квадрат со скруглением (браузер, старый Android), 'round' — круг,
    'fg' — только знак на прозрачном (передний слой адаптивной иконки, знак в безопасной зоне 66/108),
    'bg' — только фон."""
    S = 4
    px = bytearray(size * size * 4)
    scale = {'fg': 108 / 66 * 0.92}.get(kind, 1.0)       # передний слой: знак меньше (система обрежет края)
    for y in range(size):
        for x in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(S):
                for sx in range(S):
                    u = ((x + (sx + 0.5) / S) / size) * 2 - 1
                    v = ((y + (sy + 0.5) / S) / size) * 2 - 1
                    inside = True
                    if kind == 'full':
                        q = 0.22                     # скругление углов
                        dx, dy = max(abs(u) - (1 - q), 0), max(abs(v) - (1 - q), 0)
                        inside = math.hypot(dx, dy) <= q
                    elif kind == 'round':
                        inside = math.hypot(u, v) <= 1
                    if not inside:
                        continue
                    col = None if kind == 'bg' else reticle(u * scale, v * scale)
                    if col is None and kind != 'fg':
                        t = (v + 1) / 2
                        col = tuple(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t for i in range(3))
                    if col is None:
                        continue
                    acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += 1
            n = acc[3]
            if n:
                i = (y * size + x) * 4
                px[i:i + 4] = bytes((round(acc[0] / n), round(acc[1] / n), round(acc[2] / n), round(255 * n / (S * S))))
    return px


def main():
    out = []
    # браузер: manifest.json и вкладка
    for s in (192, 512):
        p = ROOT / 'game' / 'icons' / f'icon-{s}.png'
        png(p, s, s, draw(s, 'full')); out.append(p)
    p = ROOT / 'game' / 'icons' / 'favicon-32.png'
    png(p, 32, 32, draw(32, 'full')); out.append(p)
    # Android: обычная и круглая иконка (до Android 8) и слои адаптивной (8+)
    res = HERE / 'app' / 'res'
    for dpi, k in (('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)):
        s = round(48 * k)
        for name, kind in (('ic_launcher', 'full'), ('ic_launcher_round', 'round')):
            p = res / f'mipmap-{dpi}' / f'{name}.png'
            png(p, s, s, draw(s, kind)); out.append(p)
        s = round(108 * k)
        for name, kind in (('ic_launcher_fg', 'fg'), ('ic_launcher_bg', 'bg')):
            p = res / f'mipmap-{dpi}' / f'{name}.png'
            png(p, s, s, draw(s, kind)); out.append(p)
    print(f'иконки: {len(out)} файлов')


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass
    main()
