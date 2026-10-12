'use strict';
// ---------- Сеть (PeerJS / WebRTC): кооператив до 4 игроков ----------
// Хост авторитетен: противники, союзные боты, пули, урон, двери, ключи. Звезда: каждый гость связан с хостом.
// Гость сам двигает своего бойца (позиция, взгляд, стойка, наклон) и шлёт хосту ввод; курок и действия выполняет хост.
// Основа — сеть прототипа Commando (archive/commando/js/net.js).

const PEER_PREFIX = 'project-commando-real-v1-';
const SNAP_MS = 50;            // хост → гости, 20 Гц
const INPUT_MS = 33;           // гость → хост, 30 Гц

// Серверы для установки прямого соединения (ICE). STUN — узнать свой внешний адрес; TURN — ретранслятор,
// если прямое соединение не пробивается (строгий NAT, фаервол). По умолчанию — как в PeerJS (Google STUN + TURN PeerJS),
// плюс запасные STUN. Свой TURN задаётся в меню («Сеть») и хранится в браузере.
const DEFAULT_ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];
function customTurn() {
  try { const t = JSON.parse(localStorage.getItem('pcr-turn') || 'null'); return t && t.urls ? t : null; } catch (e) { return null; }
}
function iceServers() {
  const t = customTurn();
  return t ? [{ urls: t.urls.split(/[\s,]+/).filter(Boolean), username: t.username, credential: t.credential }, ...DEFAULT_ICE] : DEFAULT_ICE;
}
const peerOptions = () => ({ debug: 1, config: { iceServers: iceServers() } });

const Net = {
  peer: null, conn: null, conns: new Map(), code: '', sendT: 0, connected: false,
  mode: null,                                   // 'peer' — через интернет (PeerJS), 'ws' — прямое подключение (server.py)
  ws: null, wsConns: new Map(), addrs: [],
  inp: { fire: false, press: 0, acts: [] },     // гость: накопленный ввод до следующего пакета
};

// Лобби: 4 места; human — занято человеком; ready — нажал «Готов»
const Lobby = { slots: [], bots: true };
const emptySlots = () => [0, 1, 2, 3].map((slot) => ({ slot, human: false, name: '', ready: false }));

function send(msg) {
  if (Net.conn && Net.conn.open) { try { Net.conn.send(msg); } catch (e) { /* канал закрыт */ } }
}
function broadcast(msg) {
  for (const c of Net.conns.values()) if (c.open) { try { c.send(msg); } catch (e) { /* ignore */ } }
}

function randomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

function peerAvailable() {
  if (typeof Peer === 'undefined') { setStatus('Сетевая библиотека не загрузилась — нужен интернет. Доступна игра одному.'); return false; }
  return true;
}

// ---------- Хост ----------
function hostGame() {
  Net.mode = 'peer';
  if (!peerAvailable()) return;
  cleanupNet();
  setStatus('Создаём комнату…');
  const code = randomCode();
  const peer = new Peer(PEER_PREFIX + code, peerOptions());
  Net.peer = peer;
  peer.on('open', () => {
    Net.code = code;
    G.role = 'host'; G.mySlot = 0;
    Lobby.slots = emptySlots();
    Object.assign(Lobby.slots[0], { human: true, name: G.myName });
    enterLobby();
  });
  peer.on('connection', (c) => {
    c.on('data', (d) => onHostData(c, d));
    c.on('close', () => onGuestLeft(c));
    c.on('error', () => onGuestLeft(c));
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id') { peer.destroy(); hostGame(); return; }
    const msg = netErrorText(e.type);
    if (G.role === 'none') setStatus(msg);
    else toast(msg, 4);
  });
  // сервер знакомств недоступен — комнату никто не найдёт
  setTimeout(() => { if (Net.peer === peer && !Net.code) setStatus(netErrorText('server-timeout')); }, 10000);
}

function onHostData(c, d) {
  if (!d || typeof d !== 'object') return;
  if (d.t === 'hello') { onHello(c, d); return; }
  const slot = c.slot;
  if (slot === undefined) return;
  // голос гостя: слышит хост, и он раздаёт остальным
  if (d.t === 'vo') {
    d.s = slot;
    Voice.receive(d);
    for (const c2 of Net.conns.values()) if (c2 !== c && c2.open) { try { c2.send(d); } catch (e) { /* ignore */ } }
    return;
  }
  if (d.t === 'ready' && G.state === 'lobby') { Lobby.slots[slot].ready = !!d.v; lobbyChanged(); return; }
  if (d.t === 'restart') { if (G.state === 'dead' || G.state === 'win') restartRange(); return; }
  if (d.t !== 'i' || d.seq !== G.seq) return;
  const p = G.players.find((q) => q.slot === slot && !q.ai);
  if (!p || p.dead) return;
  // гость ведёт своего бойца сам — хост принимает позицию, взгляд и стойку
  p.net = true;
  p.x = d.x; p.y = d.y; p.a = d.a; p.crouch = !!d.c; p.ads = d.ads; p.leanWant = d.lw; p.sprint = !!d.sp;
  p.sprintLock = d.sl; p.speed = d.v;
  p.inFire = !!d.f; p.inPress = (p.inPress || 0) + (d.pr | 0); p.inHoldF = !!d.hf;
  for (const k of d.acts || []) applyAct(p, k);
}

// Курок гостя: удержание — как у своего, нажатия для одиночного огня копятся
function applyRemoteFire(p) {
  const pressedNow = (p.inPress || 0) > 0;
  pullTrigger(p, p.inFire || pressedNow, pressedNow, playerSpread(p));
  if (pressedNow) p.inPress--;
}

function onHello(c, d) {
  const name = String(d.name || 'Боец').slice(0, 16);
  if (d.v !== GAME_VERSION) { c.send({ t: 'version', v: GAME_VERSION }); setTimeout(() => c.close(), 300); return; }
  if (G.state !== 'lobby') { c.send({ t: 'busy' }); setTimeout(() => c.close(), 300); return; }
  const slot = Lobby.slots.findIndex((s) => !s.human);
  if (slot < 0) { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); return; }
  c.slot = slot;
  Net.conns.set(slot, c);
  Object.assign(Lobby.slots[slot], { human: true, name, ready: false });
  c.send({ t: 'welcome', slot, code: Net.code });
  lobbyChanged();
}

function onGuestLeft(c) {
  if (c.slot === undefined || Net.conns.get(c.slot) !== c) return;
  const slot = c.slot;
  Net.conns.delete(slot);
  const name = Lobby.slots[slot].name;
  Object.assign(Lobby.slots[slot], { human: false, name: '', ready: false });
  const p = G.players.find((q) => q.slot === slot && !q.ai);
  if (p && G.state !== 'lobby') {
    // в бою: место отдаётся союзному боту (если боты включены), иначе боец уходит
    if (Lobby.bots && !p.dead) {
      makeAI(p, p.a, null);
      const lead = G.players.find((q) => !q.ai);
      Object.assign(p, { net: false, name: 'Бот ' + (slot + 1), leader: lead ? lead.slot : -1 });
      toast(`${name} отключился — его место занял бот`, 3);
    } else {
      G.players = G.players.filter((q) => q !== p);
      toast(`${name} отключился`, 3);
    }
    G.lastSquad = (G.lastSquad || []).map((q) => (q.slot === slot ? { ...q, human: false } : q));
  }
  lobbyChanged();
}

function lobbyChanged() {
  if (G.role === 'host') broadcast({ t: 'lobby', slots: Lobby.slots, bots: Lobby.bots, code: Net.code, addrs: Net.addrs });
  if (G.state === 'lobby') renderLobby();
}

const lobbyReady = () => Lobby.slots.filter((s) => s.human).every((s) => s.ready);

// Хост/одиночка: начать, когда все люди готовы. Пустые места — ботам (если включено).
function startGameFromLobby() {
  if (G.role === 'guest' || !lobbyReady()) return;
  const squad = Lobby.slots.filter((s) => s.human).map((s) => ({ slot: s.slot, human: true, name: s.name }));
  hideMenu();
  startRange(squad, Lobby.bots);
  if (G.role === 'host') broadcast({ t: 'start' });
}

// ---------- Снимок мира (хост → гости) ----------
const ACTS = ['unlock', 'kick'];
function personState(o) {
  const g = o.gun;
  const flags = (o.dead ? 1 : 0) | (o.crouch ? 2 : 0) | (o.sprint ? 4 : 0) | (o.lamp ? 8 : 0) | (o.kneel ? 16 : 0) |
    (o.ai ? 32 : 0) | (o.seeing ? 64 : 0) | (o.down ? 128 : 0);
  const s = [o.id, o.side === 'e' ? 1 : 0, o.slot, flags, r1(o.x), r1(o.y), r2(o.a), Math.ceil(o.hp), r2(o.ads || 0), r2(o.leanPx || 0),
    o.st | 0, r2(o.notice || 0), r2(o.deadA || 0), r2(g.reloadT), r2(g.reloadDur),
    o.act ? [ACTS.indexOf(o.act.kind), r2(o.act.t), r2(o.act.dur)] : 0];
  if (o.side === 'p') s.push(o.name, [g.mag, g.chamber, g.pouch, WEAPONS[g.t].modes.indexOf(g.mode), g.reloadEmpty ? 1 : 0], [...o.keys], r2(o.supp),
    r2(o.bleed || 0), r2(o.rev || 0), o.reviving || 0, o.lastReviver || 0);
  return s;
}

function sendSnapshot() {
  broadcast({
    t: 's', seq: G.seq, gs: G.state,
    P: allPeople().map(personState),
    D: map.doors.map((d) => (d.open ? 1 : 0) | (d.locked ? 2 : 0) | (d.broken ? 4 : 0)),
    K: map.keys.map((k) => (k.taken ? 1 : 0)),
    fx: G.fxOut,
  });
  G.fxOut = [];
}

// ---------- Гость ----------
function joinGame(code) {
  if (!peerAvailable()) return;
  Net.mode = 'peer';
  code = code.trim().toUpperCase();
  if (code.length !== 5) { setStatus('Введите 5-значный код комнаты'); return; }
  cleanupNet();
  setStatus('Подключаемся к серверу…');
  const peer = new Peer(undefined, peerOptions());
  Net.peer = peer;
  // сервер знакомств не ответил — дальше не пойдём
  const srvTimeout = setTimeout(() => { if (Net.peer === peer && !peer.open) { setStatus(netErrorText('server-timeout')); cleanupNet(); } }, 12000);
  peer.on('open', () => {
    clearTimeout(srvTimeout);
    setStatus('Сервер найден, ищем комнату и устанавливаем соединение…');
    const c = peer.connect(PEER_PREFIX + code, { reliable: true });
    Net.conn = c;
    // комната найдена, но прямое соединение не пробилось — скажем почему (по состоянию ICE)
    const timeout = setTimeout(() => {
      if (Net.connected) return;
      const pc = c.peerConnection;
      const ice = pc ? pc.iceConnectionState : 'none';
      setStatus(netErrorText(ice === 'none' || ice === 'new' ? 'no-answer' : 'ice-' + ice));
      cleanupNet();
    }, 20000);
    c.on('open', () => c.send({ t: 'hello', name: G.myName, v: GAME_VERSION }));
    c.on('data', (d) => onGuestData(d, timeout, code));
    c.on('close', () => { if (G.role === 'guest') leaveToMenu('Соединение с хостом потеряно'); });
  });
  peer.on('error', (e) => {
    clearTimeout(srvTimeout);
    const msg = netErrorText(e.type);
    if (G.role === 'guest') leaveToMenu(msg);
    else { setStatus(msg); cleanupNet(); }
  });
}

// Сообщение от хоста (одинаково для PeerJS и прямого подключения)
function onGuestData(d, timeout, code) {
  if (!d || typeof d !== 'object') return;
  if (d.t === 'full' || d.t === 'busy') {
    setStatus(d.t === 'full' ? 'Комната заполнена' : 'Игра уже идёт — дождитесь конца раунда');
    clearTimeout(timeout); cleanupNet(); return;
  }
  if (d.t === 'version') {
    setStatus(`Другая версия игры: у вас ${GAME_VERSION}, у хоста ${d.v}. Обновите папку игры или откройте её по адресу хоста.`);
    clearTimeout(timeout); cleanupNet(); return;
  }
  if (d.t === 'vo') { Voice.receive(d); return; }
  if (d.t === 'welcome') {
    clearTimeout(timeout);
    Net.connected = true; Net.code = code;
    G.role = 'guest'; G.mySlot = d.slot; G.seq = -1;
    enterLobby();
    return;
  }
  if (G.role !== 'guest') return;
  if (d.t === 'lobby') { Lobby.slots = d.slots; Lobby.bots = d.bots; Net.addrs = d.addrs || Net.addrs; if (G.state === 'lobby') renderLobby(); }
  else if (d.t === 'start') { hideMenu(); if (G.state === 'lobby') G.state = 'play'; }
  else if (d.t === 's') applySnapshot(d);
}

// ---------- Прямое подключение: WebSocket через сервер хоста (server.ps1 / server.py) ----------
// Хост открывает игру со своего сервера (start.bat), гости — по адресу хоста: в локальной сети / Radmin VPN (http://IP:8000)
// или через интернет по ссылке туннеля (https://…, tunnel.bat). Сервер только пересылает сообщения; протокол игры тот же.
// Обмен с сервером: заголовок + JSON игры (серверу не нужно разбирать JSON) — см. описание протокола в server.py.
const servedByServer = () => location.protocol === 'http:' || location.protocol === 'https:';

// Адрес → ссылка WebSocket: https/wss → защищённое соединение без порта (туннель); адрес этой страницы → её протокол;
// адрес без схемы и порта → ws и порт 8000
function wsTarget(input) {
  let s = (input || '').trim();
  if (!s) return null;
  const m = /^([a-z]+):\/\//i.exec(s);
  let secure = false;
  if (m) { secure = /^(https|wss)$/i.test(m[1]); s = s.slice(m[0].length); }
  s = s.replace(/[/?#].*$/, '');
  if (!s) return null;
  if (!m && s === location.host) secure = location.protocol === 'https:';
  if (!m && !secure && !/:\d+$/.test(s)) s += ':8000';
  return { url: (secure ? 'wss://' : 'ws://') + s + '/ws', host: s, secure };
}

function hostLocal() {
  if (!servedByServer()) {
    setStatus('Для прямого подключения запустите игру через start.bat — она откроется по адресу http://localhost:8000.');
    return;
  }
  cleanupNet();
  setStatus('Создаём комнату на этом компьютере…');
  const ws = new WebSocket(wsTarget(location.host).url);
  Net.ws = ws; Net.mode = 'ws';
  ws.onopen = () => ws.send('H');
  ws.onmessage = (ev) => {
    const m = String(ev.data), k = m[0];
    if (k === 'E') {
      setStatus(m.slice(2) === 'host-exists' ? 'На этом сервере комната уже создана (игра открыта в другой вкладке?).' : 'Ошибка сервера: ' + m.slice(2));
      cleanupNet();
    } else if (k === 'O') {
      Net.addrs = m.slice(2) ? m.slice(2).split(',') : [];
      G.role = 'host'; G.mySlot = 0;
      Lobby.slots = emptySlots();
      Object.assign(Lobby.slots[0], { human: true, name: G.myName });
      enterLobby();
    } else if (k === 'J') {
      const id = +m.slice(1);
      Net.wsConns.set(id, wsConn(ws, id));
    } else if (k === 'L') {
      const id = +m.slice(1), c = Net.wsConns.get(id);
      if (c) { Net.wsConns.delete(id); c.open = false; onGuestLeft(c); }
    } else if (k === 'F') {
      const bar = m.indexOf('|'), c = Net.wsConns.get(+m.slice(1, bar));
      if (!c) return;
      let d;
      try { d = JSON.parse(m.slice(bar + 1)); } catch (e) { return; }
      onHostData(c, d);
    }
  };
  ws.onclose = () => {
    if (Net.ws !== ws) return;
    if (G.role === 'host') leaveToMenu('Связь с сервером игры потеряна — окно сервера (start.bat) закрыто?');
    else { setStatus('Сервер игры не отвечает — запустите start.bat.'); cleanupNet(); }
  };
}

// Гость на сервере хоста — для кода хоста выглядит как соединение PeerJS (send, close, open)
function wsConn(ws, id) {
  return {
    id, open: true,
    send(d) { if (ws.readyState === 1) ws.send('T' + id + '|' + JSON.stringify(d)); },
    close() { if (ws.readyState === 1) ws.send('K' + id); this.open = false; },
  };
}

function joinLocal(addr) {
  const tg = wsTarget(addr);
  if (!tg) { setStatus('Введите адрес хоста: 192.168.1.5:8000, 26.x.x.x:8000 или ссылку https://… от tunnel.bat'); return; }
  cleanupNet();
  setStatus(`Подключаемся к ${tg.host}…`);
  let ws;
  try { ws = new WebSocket(tg.url); } catch (e) { setStatus('Неверный адрес: ' + addr); return; }
  Net.ws = ws; Net.mode = 'ws';
  const conn = {
    open: false,
    send(d) { if (ws.readyState === 1) ws.send('M|' + JSON.stringify(d)); },
    close() { try { ws.close(); } catch (e) { /* ignore */ } },
  };
  Net.conn = conn;
  const hint = tg.secure ? 'Ссылка туннеля ещё действует (окно tunnel.bat у хоста открыто)?'
    : 'Хост запустил start.bat? Адрес открывается в браузере? Фаервол хоста разрешил доступ?';
  const timeout = setTimeout(() => {
    if (Net.connected || Net.ws !== ws) return;
    setStatus(`Нет ответа от ${tg.host}. ${hint}`);
    cleanupNet();
  }, 10000);
  ws.onopen = () => ws.send('G');
  ws.onmessage = (ev) => {
    const m = String(ev.data), k = m[0];
    if (k === 'E') {
      clearTimeout(timeout);
      setStatus(m.slice(2) === 'no-host' ? 'Сервер найден, но комнаты ещё нет: хост должен нажать «Создать комнату на этом компьютере».' : 'Ошибка сервера: ' + m.slice(2));
      cleanupNet();
    } else if (k === 'W') {
      conn.open = true;
      conn.send({ t: 'hello', name: G.myName, v: GAME_VERSION });
    } else if (k === 'X') {
      clearTimeout(timeout);
      if (G.role === 'guest') leaveToMenu('Хост закрыл комнату'); else { setStatus('Хост закрыл комнату'); cleanupNet(); }
    } else if (k === 'M') {
      let d;
      try { d = JSON.parse(m.slice(2)); } catch (e) { return; }
      onGuestData(d, timeout, tg.host);
    }
  };
  ws.onclose = () => {
    if (Net.ws !== ws) return;
    clearTimeout(timeout);
    if (G.role === 'guest') leaveToMenu('Соединение с хостом потеряно');
    else if (!Net.connected) { setStatus(`Не удалось подключиться к ${tg.host}. ${hint}`); cleanupNet(); }
  };
}

function guestSendInput() {
  const p = me();
  if (!p || p.dead) { Net.inp.acts = []; Net.inp.press = 0; return; }   // раненый тоже шлёт: ползёт
  send({ t: 'i', seq: G.seq, x: r1(p.x), y: r1(p.y), a: r2(p.a), c: p.crouch ? 1 : 0, ads: r2(p.ads), lw: p.leanWant | 0,
    sp: p.sprint ? 1 : 0, sl: r2(p.sprintLock), v: r1(p.speed), f: Net.inp.fire ? 1 : 0, pr: Net.inp.press, acts: Net.inp.acts,
    hf: keys.KeyF ? 1 : 0 });
  Net.inp.press = 0; Net.inp.acts = [];
}

// Новый запуск полигона у хоста — пересобрать мир у себя
function resetGuestWorld(seq) {
  buildRange();
  G.seq = seq;
  G.players = []; G.enemies = []; G.bullets = []; G.parts = []; G.decals = []; G.hurt = [];
  G.hitmark = null; G.toast = null; G.muzzle = []; G.expo = null; G.barks = [];
  fieldCache.clear();
  G.stateT = 0;
  hideMenu();
}

function applySnapshot(s) {
  const fresh = s.seq !== G.seq;
  if (fresh) resetGuestWorld(s.seq);
  if (G.state !== s.gs) G.stateT = 0;
  G.state = s.gs;
  const mine = G.mySlot;
  const known = new Map(allPeople().map((o) => [o.id, o]));
  const players = [], enemies = [];
  for (const q of s.P) {
    const [id, side, slot, flags, x, y, a, hp, ads, leanPx, st, notice, deadA, reloadT, reloadDur, act] = q;
    let o = known.get(id);
    if (!o) {
      o = makePerson(side ? 'e' : 'p', x, y, a);
      o.id = id; o.slot = slot;
      o.nx = x; o.ny = y;
    }
    const own = side === 0 && slot === mine && !(flags & 32);
    const wasDead = o.dead;
    o.dead = !!(flags & 1); o.hp = hp; o.ai = !!(flags & 32); o.st = st; o.notice = notice; o.seeing = !!(flags & 64);
    o.lamp = !!(flags & 8); o.kneel = !!(flags & 16); o.deadA = deadA;
    if (o.dead && !wasDead) o.deadT = G.time;
    o.gun.reloadT = reloadT; o.gun.reloadDur = reloadDur;
    o.act = act ? { kind: ACTS[act[0]], t: act[1], dur: act[2] } : null;
    if (side === 0) {
      const [, , , , , , , , , , , , , , , , name, gun, keysArr, supp, bleed, rev, reviving, lastReviver] = q;
      o.name = name;
      o.down = !!(flags & 128); o.bleed = bleed; o.rev = rev; o.reviving = reviving; o.lastReviver = lastReviver;
      o.gun.mag = gun[0]; o.gun.chamber = gun[1]; o.gun.pouch = gun[2]; o.gun.mode = WEAPONS[o.gun.t].modes[gun[3]]; o.gun.reloadEmpty = !!gun[4];
      o.keys = new Set(keysArr); o.supp = supp;
    }
    if (own) {
      // свой боец: позицию и стойку ведём сами; хост переставляет только на новом запуске
      if (fresh) { o.x = o.px = x; o.y = o.py = y; o.a = a; G.cam.x = x; G.cam.y = y; }
    } else {
      o.nx = x; o.ny = y; o.a = a;
      o.crouch = !!(flags & 2); o.sprint = !!(flags & 4); o.ads = ads; o.leanPx = leanPx; o.lean = Math.sign(leanPx);
      const side2 = a + Math.PI / 2 * Math.sign(leanPx);
      o.lxOff = Math.cos(side2) * Math.abs(leanPx); o.lyOff = Math.sin(side2) * Math.abs(leanPx);
      if (fresh || Math.hypot(o.x - x, o.y - y) > M(4)) { o.x = x; o.y = y; }
    }
    (side ? enemies : players).push(o);
  }
  G.players = players; G.enemies = enemies;
  // двери и ключи
  s.D.forEach((b, i) => {
    const d = map.doors[i];
    const open = !!(b & 1), locked = !!(b & 2), broken = !!(b & 4);
    if (d.open !== open || d.locked !== locked || d.broken !== broken) {
      d.open = open; d.locked = locked; d.broken = broken;
      syncDoorTile(d);
      if (fresh) d.ang = doorPassable(d) ? 1 : 0;
    }
  });
  s.K.forEach((t, i) => { map.keys[i].taken = !!t; });
  for (const ev of s.fx) playFx(ev);
}

// Отправка по таймеру: хост — снимки, гость — ввод
function netTick(dt) {
  if (G.role === 'host') {
    Net.sendT -= dt * 1000;
    if (Net.sendT <= 0) { if (Net.conns.size && map) sendSnapshot(); else G.fxOut = []; Net.sendT = SNAP_MS; }
  } else if (G.role === 'guest') {
    Net.sendT -= dt * 1000;
    if (Net.sendT <= 0) { guestSendInput(); Net.sendT = INPUT_MS; }
  }
}

// Понятные причины сбоев подключения
function netErrorText(t) {
  const M = {
    'peer-unavailable': 'Комната не найдена. Проверьте код; хост должен быть в лобби (не в игре), и у обоих — одна версия игры.',
    'server-timeout': 'Нет связи с сервером PeerJS (0.peerjs.com). Проверьте интернет; возможно, его блокирует фаервол, антивирус или сеть.',
    'server-error': 'Сервер PeerJS не отвечает. Попробуйте позже.',
    'network': 'Потеряна связь с сервером PeerJS. Проверьте интернет.',
    'socket-error': 'Ошибка связи с сервером PeerJS. Проверьте интернет и фаервол.',
    'socket-closed': 'Связь с сервером PeerJS закрыта. Проверьте интернет.',
    'browser-incompatible': 'Браузер не поддерживает WebRTC. Используйте Chrome, Edge или Firefox.',
    'webrtc': 'Ошибка WebRTC в браузере.',
    'no-answer': 'Комната не ответила. Хост должен быть в лобби с этим кодом и не закрывать вкладку.',
    'ice-checking': 'Комната найдена, но прямое соединение не установилось: сеть одного из игроков его не пропускает (строгий NAT или фаервол). Нужен TURN-сервер — меню «Сеть».',
    'ice-failed': 'Комната найдена, но прямое соединение не удалось: сеть одного из игроков его не пропускает (строгий NAT или фаервол). Нужен TURN-сервер — меню «Сеть».',
    'ice-disconnected': 'Соединение с хостом оборвалось. Попробуйте ещё раз.',
  };
  return M[t] || 'Ошибка сети: ' + t;
}

// Проверка сети: сервер знакомств, внешний адрес (STUN), ретранслятор (TURN). Отчёт — объект и строки для меню.
async function netCheck(report) {
  const res = { server: false, srflx: false, relay: false, relayTcp: false, host: false, ms: 0 };
  const line = (s) => report && report(s);
  if (typeof Peer === 'undefined') { line('✗ Сетевая библиотека не загрузилась — нет интернета или заблокирован jsdelivr.net'); return res; }
  // 1) сервер знакомств
  const t0 = performance.now();
  await new Promise((resolve) => {
    let done = false;
    const peer = new Peer(undefined, peerOptions());
    const fin = (ok) => { if (done) return; done = true; res.server = ok; res.ms = Math.round(performance.now() - t0); try { peer.destroy(); } catch (e) { /* ignore */ } resolve(); };
    peer.on('open', () => fin(true));
    peer.on('error', () => fin(false));
    setTimeout(() => fin(false), 10000);
  });
  line(res.server ? `✓ Сервер PeerJS доступен (${res.ms} мс)` : '✗ Сервер PeerJS недоступен — подключиться никто не сможет (интернет, фаервол, антивирус)');
  // 2) кандидаты ICE
  try {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    pc.createDataChannel('probe');
    const gathered = new Promise((resolve) => {
      pc.onicecandidate = (ev) => {
        if (!ev.candidate) { resolve(); return; }
        const c = ev.candidate.candidate;
        if (/ typ host/.test(c)) res.host = true;
        if (/ typ srflx/.test(c)) res.srflx = true;
        if (/ typ relay/.test(c)) { res.relay = true; if (/ tcp /i.test(c)) res.relayTcp = true; }
      };
      setTimeout(resolve, 8000);
    });
    await pc.setLocalDescription(await pc.createOffer());
    await gathered;
    pc.close();
  } catch (e) { line('✗ WebRTC недоступен в этом браузере: ' + e); return res; }
  line(res.srflx ? '✓ Внешний адрес определён (STUN) — прямое соединение возможно' : '✗ Внешний адрес не определён (STUN заблокирован) — прямое соединение вряд ли получится');
  line(res.relay ? '✓ Ретранслятор (TURN) доступен — соединение пройдёт даже через строгий NAT' : '✗ Ретранслятор (TURN) недоступен — при строгом NAT/фаерволе соединения не будет. Укажите свой TURN в «Сеть».');
  return res;
}

function cleanupNet() {
  const ws = Net.ws;
  Net.ws = null;
  try { if (ws) ws.close(); } catch (e) { /* ignore */ }
  Net.wsConns.clear(); Net.mode = null;
  try { if (Net.conn) Net.conn.close(); } catch (e) { /* ignore */ }
  for (const c of Net.conns.values()) { try { c.close(); } catch (e) { /* ignore */ } }
  try { if (Net.peer) Net.peer.destroy(); } catch (e) { /* ignore */ }
  Net.conn = null; Net.peer = null; Net.connected = false; Net.code = ''; Net.conns.clear();
}

function leaveToMenu(msg) {
  cleanupNet();
  Voice.reset();
  G.role = 'none'; G.state = 'menu';
  G.players = []; G.enemies = []; G.bullets = []; G.parts = []; G.decals = [];
  map = null;
  showMenu();
  setStatus(msg || '');
}
