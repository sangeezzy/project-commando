// Онлайн-ретранслятор PROJECT COMMANDO на Cloudflare Workers: раздаёт игру (https — микрофон работает у всех)
// и пересылает игровые сообщения между хостом и гостями комнаты по WebSocket /ws?room=КОД.
// Протокол тот же, что у server.py (заголовок перед JSON игры, JSON не разбирается):
//   хост → H, T<id>|…, A|…, K<id>;   гость → G, M|…
//   хосту ← O|, J<id>, L<id>, F<id>|…, E|…;   гостю ← W<id>, M|…, X, E|…
// Каждая комната — отдельный Durable Object (по коду). Сокеты принимаются через Hibernation API:
// роль и номер гостя хранятся во вложении сокета, поэтому объект может выгружаться из памяти, пока все молчат.
// Развернуть: deploy.bat (или npx wrangler deploy --config cloud/wrangler.toml).

const MAX_GUESTS = 7;
const ROOM_RE = /^[A-Z0-9]{4,8}$/;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      if ((req.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return new Response('WebSocket only', { status: 426 });
      const code = (url.searchParams.get('room') || '').toUpperCase();
      if (!ROOM_RE.test(code)) return badRoom();
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};

// Неверный код: ответить по протоколу (E|bad-room), чтобы игра показала понятную ошибку
function badRoom() {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.send('E|bad-room');
  server.close(1000, 'bad room');
  return new Response(null, { status: 101, webSocket: client });
}

const say = (ws, text) => { try { ws.send(text); } catch (e) { /* сокет уже закрыт */ } };
const shut = (ws) => { try { ws.close(1000, ''); } catch (e) { /* уже закрыт */ } };

export class Room {
  // tags — кэш вложений в памяти (на каждое сообщение не разбирать вложения всех сокетов);
  // после выгрузки объекта он пуст и заполняется из вложений заново
  constructor(ctx) { this.ctx = ctx; this.tags = new WeakMap(); }

  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    this.setTag(server, {});
    return new Response(null, { status: 101, webSocket: client });
  }

  tag(ws) {
    let t = this.tags.get(ws);
    if (!t) { t = ws.deserializeAttachment() || {}; this.tags.set(ws, t); }
    return t;
  }
  setTag(ws, t) { ws.serializeAttachment(t); this.tags.set(ws, t); }

  members(except) {
    return this.ctx.getWebSockets().filter((w) => w !== except).map((w) => [w, this.tag(w)]);
  }
  host(except) { const m = this.members(except).find(([, t]) => t.role === 'host'); return m && m[0]; }
  guests(except) { return this.members(except).filter(([, t]) => t.role === 'guest'); }
  guest(id) { const m = this.guests().find(([, t]) => t.id === id); return m && m[0]; }

  webSocketMessage(ws, msg) {
    if (typeof msg !== 'string') return;
    const me = this.tag(ws);
    if (!me.role) {
      if (msg === 'H') {
        if (this.host(ws)) { say(ws, 'E|host-exists'); shut(ws); return; }
        this.setTag(ws, { role: 'host' });
        say(ws, 'O|');
      } else if (msg === 'G') {
        const h = this.host(ws);
        if (!h) { say(ws, 'E|no-host'); shut(ws); return; }
        const gs = this.guests(ws);
        if (gs.length >= MAX_GUESTS) { say(ws, 'E|full'); shut(ws); return; }
        const id = gs.reduce((m, [, t]) => Math.max(m, t.id), 0) + 1;
        this.setTag(ws, { role: 'guest', id });
        say(ws, 'W' + id);
        say(h, 'J' + id);
      }
      return;
    }
    if (me.role === 'host') {
      if (msg.startsWith('A|')) {
        const body = 'M|' + msg.slice(2);
        for (const [g] of this.guests()) say(g, body);
      } else if (msg[0] === 'T') {
        const bar = msg.indexOf('|');
        const g = bar > 1 && this.guest(+msg.slice(1, bar));
        if (g) say(g, 'M|' + msg.slice(bar + 1));
      } else if (msg[0] === 'K') {
        const g = this.guest(+msg.slice(1));
        if (g) { this.setTag(g, { role: 'kicked' }); shut(g); }
      }
    } else if (me.role === 'guest' && msg.startsWith('M|')) {
      const h = this.host();
      if (h) say(h, 'F' + me.id + '|' + msg.slice(2));
    }
  }

  webSocketClose(ws) { this.gone(ws); }
  webSocketError(ws) { this.gone(ws); }

  gone(ws) {
    const me = this.tag(ws);
    this.setTag(ws, { role: 'left' });
    shut(ws);
    if (me.role === 'host') {
      // хост ушёл — комната закрыта
      for (const [g] of this.guests(ws)) { this.setTag(g, { role: 'left' }); say(g, 'X'); shut(g); }
    } else if (me.role === 'guest') {
      const h = this.host(ws);
      if (h) say(h, 'L' + me.id);
    }
  }
}
