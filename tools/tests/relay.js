// Онлайн-сервер cloud/worker.js без Cloudflare: исходник грузится сюда, сокеты, WebSocketPair и Response — заглушки.
// Комнаты (свой Durable Object на код), протокол как у server.py, восстановление после выгрузки объекта (новый экземпляр Room).
(() => {
  const { check } = T_;
  const xhr = new XMLHttpRequest();
  xhr.open('GET', new URL('../../cloud/worker.js', document.querySelector('script[src*="tests/relay.js"]').src).href, false);
  xhr.send();
  const src = xhr.responseText.replace('export default', 'const __def =').replace('export class', 'class');

  // заглушка сокета Cloudflare: send копит в got, вложение — через JSON (как сериализация в рантайме)
  class FakeWS {
    constructor() { this.got = []; this.closed = false; this.att = null; }
    send(t) { if (this.closed) throw new Error('closed'); this.got.push(t); }
    close() { this.closed = true; }
    accept() {}
    serializeAttachment(v) { this.att = JSON.stringify(v); }
    deserializeAttachment() { return this.att ? JSON.parse(this.att) : null; }
  }
  class FakePair { constructor() { this[0] = new FakeWS(); this[1] = new FakeWS(); Object.defineProperty(this[0], 'srv', { value: this[1] }); } }
  class FakeResponse { constructor(body, init) { Object.assign(this, init || {}); } }
  const { def, Room } = new Function('WebSocketPair', 'Response', src + '\nreturn { def: __def, Room };')(FakePair, FakeResponse);

  // ctx Durable Object: принятые сокеты (закрытые рантайм из списка убирает)
  const makeCtx = (list = []) => ({ list, acceptWebSocket(ws) { list.push(ws); }, getWebSockets() { return list.filter((w) => !w.closed); } });
  const rooms = new Map();
  const env = {
    ASSETS: { fetch: () => 'asset' },
    ROOMS: { idFromName: (n) => n, get: (id) => { if (!rooms.has(id)) rooms.set(id, new Room(makeCtx())); return rooms.get(id); } },
  };
  const req = (path, ws = true) => ({ url: 'https://x.workers.dev' + path, headers: { get: (k) => (k === 'Upgrade' && ws ? 'websocket' : null) } });
  // подключиться: серверный сокет (его видит Room) и его комната
  async function join(path) {
    const before = new Set(rooms.keys());
    const res = await def.fetch(req(path), env);
    const code = new URL('https://x' + path).searchParams.get('room').toUpperCase();
    const room = rooms.get(code);
    const srv = room ? room.ctx.list[room.ctx.list.length - 1] : null;
    return { res, room, srv, code, fresh: !before.has(code) };
  }
  const msg = (c, text) => c.room.webSocketMessage(c.srv, text);

  window.__result = (async () => {
    check('файлы игры раздаются (не /ws)', (await def.fetch(req('/index.html', false), env)) === 'asset');
    const bad = await def.fetch(req('/ws?room=x!'), env);
    check('неверный код — E|bad-room, комната не создаётся', bad.status === 101 && bad.webSocket.srv.got[0] === 'E|bad-room' && rooms.size === 0, bad.webSocket.srv.got);

    const h1 = await join('/ws?room=AAAA1'), h2 = await join('/ws?room=AAAA2');
    msg(h1, 'H'); msg(h2, 'H');
    check('две комнаты: у каждой свой объект, хостам O|', h1.room !== h2.room && h1.srv.got[0] === 'O|' && h2.srv.got[0] === 'O|', [h1.srv.got, h2.srv.got]);
    const dup = await join('/ws?room=aaaa1');
    msg(dup, 'H');
    check('код занят — E|host-exists и закрыт; код без учёта регистра', dup.room === h1.room && dup.srv.got[0] === 'E|host-exists' && dup.srv.closed, dup.srv.got);
    const none = await join('/ws?room=AAAA3');
    msg(none, 'G');
    check('нет хоста — E|no-host', none.srv.got[0] === 'E|no-host' && none.srv.closed, none.srv.got);

    const g1 = await join('/ws?room=AAAA1'), g2 = await join('/ws?room=AAAA1');
    msg(g1, 'G'); msg(g2, 'G');
    check('гости получают W1, W2; хост — J1, J2; другая комната не слышит', g1.srv.got[0] === 'W1' && g2.srv.got[0] === 'W2' &&
      h1.srv.got.join() === 'O|,J1,J2' && h2.srv.got.length === 1, [g1.srv.got, g2.srv.got, h1.srv.got, h2.srv.got]);
    msg(g2, 'M|{"i":2}');
    check('гость → хост: F<id>|…', h1.srv.got.at(-1) === 'F2|{"i":2}', h1.srv.got);
    msg(h1, 'A|{"s":1}');
    msg(h1, 'T1|{"only":1}');
    check('хост → всем (A|) и одному (T<id>|)', g1.srv.got.join() === 'W1,M|{"s":1},M|{"only":1}' && g2.srv.got.join() === 'W2,M|{"s":1}', [g1.srv.got, g2.srv.got]);

    // выгрузка объекта (Hibernation): новый экземпляр Room с теми же сокетами — роли из вложений
    const woke = new Room(makeCtx(h1.room.ctx.list));
    rooms.set('AAAA1', woke);
    woke.webSocketMessage(g1.srv, 'M|{"after":1}');
    woke.webSocketMessage(h1.srv, 'T2|{"to":2}');
    check('после выгрузки: роли и номера гостей восстановлены', h1.srv.got.at(-1) === 'F1|{"after":1}' && g2.srv.got.at(-1) === 'M|{"to":2}', [h1.srv.got, g2.srv.got]);
    const g3 = await join('/ws?room=AAAA1');
    msg(g3, 'G');
    check('после выгрузки: новый гость получает свободный номер', g3.srv.got[0] === 'W3' && h1.srv.got.at(-1) === 'J3', [g3.srv.got, h1.srv.got]);

    woke.webSocketMessage(h1.srv, 'K3');
    check('K<id> — хост отключает гостя', g3.srv.closed, g3.srv.got);
    woke.webSocketClose(g3.srv);
    check('отключённому хостом L не шлётся', h1.srv.got.at(-1) === 'J3', h1.srv.got);
    g2.srv.closed = true;
    woke.webSocketClose(g2.srv);
    check('гость ушёл — хосту L<id>', h1.srv.got.at(-1) === 'L2', h1.srv.got);
    h1.srv.closed = true;
    woke.webSocketClose(h1.srv);
    check('хост ушёл — гостям X, сокеты закрыты', g1.srv.got.at(-1) === 'X' && g1.srv.closed, g1.srv.got);
    const again = await join('/ws?room=AAAA1');
    msg(again, 'H');
    check('код освободился — можно создать комнату заново', again.srv.got[0] === 'O|', again.srv.got);

    // лимит гостей
    const full = [];
    for (let i = 0; i < 8; i++) { const g = await join('/ws?room=AAAA2'); msg(g, 'G'); full.push(g.srv.got[0]); }
    check('больше 7 гостей — E|full', full.slice(0, 7).every((t) => /^W\d$/.test(t)) && full[7] === 'E|full', full);
    return T_.checks;
  })();
})();
