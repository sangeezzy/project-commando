"""Сервер игры PROJECT COMMANDO для прямого подключения (без интернета и сторонних серверов).

Раздаёт файлы игры и пересылает игровые сообщения между хостом и гостями по WebSocket (/ws).
Только стандартная библиотека Python 3.8+.

    python server.py            # порт 8000
    python server.py 8080       # другой порт
    python server.py --open     # и открыть игру в браузере

Без Python (Windows): server.ps1 — то же самое на PowerShell (его запускает start.bat).

Хост открывает http://localhost:8000, гости — http://<адрес хоста>:8000 (адреса печатаются при запуске).
Комнаты: /ws — общая комната сервера (прямое подключение), /ws?room=КОД — комната по коду (онлайн-режим:
сервер-ретранслятор в интернете, например на VPS; то же делает cloud/worker.js на Cloudflare).
"""
import asyncio
import base64
import hashlib
import mimetypes
import os
import re
import socket
import struct
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
WS_MAGIC = b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
REPORT_FILE = None          # для автотестов: POST /report пишется сюда (--report путь)
OPEN = False                # --open: открыть игру в браузере, когда сервер запущен

try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass


# ---------- WebSocket ----------
class WS:
    def __init__(self, reader, writer):
        self.r, self.w = reader, writer
        self.closed = False
        self.lock = asyncio.Lock()

    async def recv(self):
        """Следующее текстовое сообщение или None (закрыто)."""
        buf = b''
        while True:
            try:
                h = await self.r.readexactly(2)
            except (asyncio.IncompleteReadError, ConnectionError):
                return None
            fin, op = h[0] & 0x80, h[0] & 0x0F
            n = h[1] & 0x7F
            if n == 126:
                n = struct.unpack('!H', await self.r.readexactly(2))[0]
            elif n == 127:
                n = struct.unpack('!Q', await self.r.readexactly(8))[0]
            mask = await self.r.readexactly(4) if h[1] & 0x80 else None
            data = await self.r.readexactly(n) if n else b''
            if mask and n:
                # снять маску целиком (XOR длинных целых) — в разы быстрее побайтного цикла
                m = (mask * (n // 4 + 1))[:n]
                data = (int.from_bytes(data, 'big') ^ int.from_bytes(m, 'big')).to_bytes(n, 'big')
            if op == 8:                       # закрыть
                return None
            if op == 9:                       # ping → pong
                await self._frame(0xA, data)
                continue
            if op == 0xA:
                continue
            buf += data
            if fin:
                return buf.decode('utf-8', 'replace')

    async def _frame(self, op, data):
        n = len(data)
        head = bytes([0x80 | op])
        if n < 126:
            head += bytes([n])
        elif n < 65536:
            head += bytes([126]) + struct.pack('!H', n)
        else:
            head += bytes([127]) + struct.pack('!Q', n)
        async with self.lock:
            self.w.write(head + data)
            await self.w.drain()

    async def send_text(self, text):
        if self.closed:
            return
        try:
            await self._frame(1, text.encode('utf-8'))
        except (ConnectionError, RuntimeError):
            self.closed = True

    def close(self):
        self.closed = True
        try:
            self.w.close()
        except Exception:
            pass


# ---------- Комната: хост и гости, пересылка ----------
# Протокол (заголовок перед JSON игры, серверу не нужно его разбирать):
#   хост → сервер: H (создать комнату), T<id>|… (гостю), A|… (всем гостям), K<id> (отключить гостя)
#   гость → сервер: G (войти), M|… (хосту)
#   сервер → хосту: O|адреса, J<id> (вошёл), L<id> (вышел), F<id>|… (от гостя), E|ошибка
#   сервер → гостю: W<id> (вошёл), M|… (от хоста), X (хост ушёл), E|ошибка
#   ошибки: host-exists (комната с этим кодом уже есть), no-host (комнаты нет), full (комната заполнена)
MAX_GUESTS = 7              # в игре 4 места; лишние получат от хоста «комната заполнена»
MAX_ROOMS = 500
ROOM_RE = re.compile(r'^[A-Z0-9]{4,8}$')


class Room:
    def __init__(self, code=''):
        self.code = code
        self.host = None
        self.guests = {}
        self.next_id = 1

    def label(self):
        return f'Комната {self.code}' if self.code else 'Комната'

    async def serve(self, ws, addrs):
        hello = await ws.recv()
        if hello == 'H':
            if self.host and not self.host.closed:
                await ws.send_text('E|host-exists')
                return
            self.host = ws
            await ws.send_text('O|' + ','.join(addrs))
            print(f'{self.label()}: хост создал комнату')
            try:
                while True:
                    m = await ws.recv()
                    if m is None:
                        break
                    if m.startswith('A|'):
                        body = 'M|' + m[2:]
                        for g in list(self.guests.values()):
                            await g.send_text(body)
                    elif m.startswith('T'):
                        bar = m.find('|')
                        try:
                            g = self.guests.get(int(m[1:bar]))
                        except ValueError:
                            g = None
                        if g:
                            await g.send_text('M|' + m[bar + 1:])
                    elif m.startswith('K'):
                        try:
                            g = self.guests.pop(int(m[1:]), None)
                        except ValueError:
                            g = None
                        if g:
                            g.close()
            finally:
                if self.host is ws:
                    self.host = None
                    print(f'{self.label()}: хост вышел — комната закрыта')
                    for g in list(self.guests.values()):
                        await g.send_text('X')
                        g.close()
                    self.guests.clear()
        elif hello == 'G':
            if not self.host or self.host.closed:
                await ws.send_text('E|no-host')
                return
            if len(self.guests) >= MAX_GUESTS:
                await ws.send_text('E|full')
                return
            gid = self.next_id
            self.next_id += 1
            self.guests[gid] = ws
            await ws.send_text(f'W{gid}')
            await self.host.send_text(f'J{gid}')
            print(f'{self.label()}: гость {gid} подключился')
            try:
                while True:
                    m = await ws.recv()
                    if m is None:
                        break
                    if m.startswith('M|') and self.host:
                        await self.host.send_text(f'F{gid}|' + m[2:])
            finally:
                if self.guests.pop(gid, None) is not None and self.host:
                    await self.host.send_text(f'L{gid}')
                print(f'{self.label()}: гость {gid} отключился')


ROOMS = {'': Room()}         # '' — общая комната сервера (прямое подключение)


def room_for(code):
    """Комната по коду (None — неверный код или слишком много комнат). Пустые комнаты удаляются после выхода."""
    if code == '':
        return ROOMS['']
    if not ROOM_RE.match(code):
        return None
    r = ROOMS.get(code)
    if r is None:
        if len(ROOMS) > MAX_ROOMS:
            return None
        r = ROOMS[code] = Room(code)
    return r


def drop_if_empty(room):
    if room.code and not room.guests and (room.host is None or room.host.closed) and ROOMS.get(room.code) is room:
        del ROOMS[room.code]


def local_addrs():
    """Адреса этого компьютера, по которым к нему могут подключиться (локальная сеть, Radmin VPN, ZeroTier, Tailscale…)."""
    out = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            out.add(info[4][0])
    except OSError:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        out.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return sorted(a for a in out if not a.startswith('127.'))


# ---------- HTTP: файлы игры + переход на WebSocket ----------
async def handle(reader, writer):
    try:
        head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 15)
    except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, ConnectionError):
        writer.close()
        return
    lines = head.decode('latin-1').split('\r\n')
    try:
        method, target, _ = lines[0].split(' ', 2)
    except ValueError:
        writer.close()
        return
    hdr = {}
    for ln in lines[1:]:
        if ':' in ln:
            k, v = ln.split(':', 1)
            hdr[k.strip().lower()] = v.strip()
    path = unquote(urlparse(target).path)

    if path == '/ws' and hdr.get('upgrade', '').lower() == 'websocket':
        key = hdr.get('sec-websocket-key', '')
        acc = base64.b64encode(hashlib.sha1(key.encode() + WS_MAGIC).digest()).decode()
        writer.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                      f'Sec-WebSocket-Accept: {acc}\r\n\r\n').encode())
        await writer.drain()
        sock = writer.get_extra_info('socket')
        if sock is not None:
            try:
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)   # без задержек мелких пакетов
            except OSError:
                pass
        port = writer.get_extra_info('sockname')[1]
        ws = WS(reader, writer)
        code = (parse_qs(urlparse(target).query).get('room') or [''])[0].upper()
        room = room_for(code)
        try:
            if room is None:
                await ws.send_text('E|bad-room')
            else:
                await room.serve(ws, [f'{a}:{port}' for a in local_addrs()] if not code else [])
        finally:
            ws.close()
            if room is not None:
                drop_if_empty(room)
        return

    if method == 'POST' and path == '/report' and REPORT_FILE:
        n = int(hdr.get('content-length', '0') or 0)
        body = await reader.readexactly(n) if n else b''
        Path(REPORT_FILE).write_bytes(body)
        writer.write(b'HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
        await writer.drain()
        writer.close()
        return

    if method not in ('GET', 'HEAD'):
        writer.write(b'HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
        await writer.drain()
        writer.close()
        return
    if path.endswith('/'):
        path += 'index.html'
    f = (ROOT / path.lstrip('/')).resolve()
    if ROOT not in f.parents and f != ROOT or not f.is_file():
        body = 'Не найдено'.encode('utf-8')
        writer.write(b'HTTP/1.1 404 Not Found\r\nContent-Type: text/plain; charset=utf-8\r\n'
                     + f'Content-Length: {len(body)}\r\nConnection: close\r\n\r\n'.encode() + body)
        await writer.drain()
        writer.close()
        return
    data = f.read_bytes()
    ctype = mimetypes.guess_type(f.name)[0] or 'application/octet-stream'
    if ctype.startswith('text/') or ctype in ('application/javascript', 'application/json'):
        ctype += '; charset=utf-8'
    writer.write((f'HTTP/1.1 200 OK\r\nContent-Type: {ctype}\r\nContent-Length: {len(data)}\r\n'
                  'Cache-Control: no-cache\r\nConnection: close\r\n\r\n').encode())
    if method == 'GET':
        writer.write(data)
    await writer.drain()
    writer.close()


async def main(port):
    mimetypes.add_type('application/javascript', '.js')
    server = await asyncio.start_server(handle, '0.0.0.0', port)
    print(f'PROJECT COMMANDO — сервер запущен, порт {port}')
    print(f'  Хост (этот компьютер):  http://localhost:{port}')
    addrs = local_addrs()
    if addrs:
        print('  Друзьям — один из адресов (свой у каждой сети):')
        for a in addrs:
            print(f'    http://{a}:{port}')
    print('  Через интернет без общей сети — запустите tunnel.bat и отправьте друзьям выданную ссылку.')
    print('  Не закрывайте это окно, пока идёт игра. Остановить — Ctrl+C.')
    if OPEN:
        import webbrowser
        webbrowser.open(f'http://localhost:{port}/')
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    args = [a for a in sys.argv[1:]]
    if '--open' in args:
        args.remove('--open')
        OPEN = True
    if '--report' in args:
        i = args.index('--report')
        REPORT_FILE = args[i + 1]
        del args[i:i + 2]
    port = int(args[0]) if args else 8000
    try:
        asyncio.run(main(port))
    except KeyboardInterrupt:
        pass
    except OSError as e:
        print(f'Не удалось запустить сервер на порту {port}: {e}')
        print('Возможно, порт занят (уже открыта игра?). Попробуйте: python server.py 8080')
        input('Enter — закрыть')
