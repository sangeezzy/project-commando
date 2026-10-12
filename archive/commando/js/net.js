'use strict';
// ---------- Сеть (PeerJS / WebRTC) ----------
// Хост авторитетен: враги, союзники, пули, урон, объекты, сценарий. Звезда: каждый гость связан с хостом.
// Гость сам двигает своего героя (и спидер, если за рулём) и шлёт ввод хосту.

const Net = { peer: null, conn: null, conns: new Map(), code: '', sendT: 0, connected: false };

// Лобби: 4 места. idx места = idx героя. ch — выбранный персонаж (-1 не выбран).
const Lobby = { slots: [] };
function emptySlots() {
  return [0, 1, 2, 3].map((idx) => ({ idx, human: false, name: '', ch: -1, ready: false, peer: '' }));
}

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
  if (typeof Peer === 'undefined') { setStatus('PeerJS не загрузился — нужен интернет. Доступна только одиночная игра.'); return false; }
  return true;
}

// ---------- Хост ----------
function hostGame() {
  if (!peerAvailable()) return;
  cleanupNet();
  setStatus('Создаём комнату…');
  const code = randomCode();
  const peer = new Peer(PEER_PREFIX + code, { debug: 1 });
  Net.peer = peer;
  peer.on('open', () => {
    Net.code = code;
    G.role = 'host'; G.myIdx = 0;
    G.progress = loadProgress();
    Lobby.slots = emptySlots();
    Object.assign(Lobby.slots[0], { human: true, name: G.myName, peer: peer.id });
    enterLobby();
  });
  peer.on('connection', (c) => {
    c.on('data', (d) => onHostData(c, d));
    c.on('close', () => onGuestLeft(c));
    c.on('error', () => onGuestLeft(c));
  });
  peer.on('call', (call) => Voice.onIncoming(call));
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id') { peer.destroy(); hostGame(); return; }
    if (e.type === 'peer-unavailable') return;     // звонок ушедшему игроку
    if (G.role === 'none') setStatus('Ошибка сети: ' + e.type);
    else G.toast = { text: 'Ошибка сети: ' + e.type, t: 3 };
  });
}

function onHostData(c, d) {
  if (!d || typeof d !== 'object') return;
  if (d.t === 'hello') { onHello(c, d); return; }
  const idx = c.idx;
  if (idx === undefined) return;
  const slot = Lobby.slots[idx];
  if (d.t === 'pick' && G.state === 'lobby') { pickChar(idx, d.ch); return; }
  if (d.t === 'ready' && G.state === 'lobby') { slot.ready = !!d.v && slot.ch >= 0; lobbyChanged(); return; }
  const p = pById(idx);
  if (!p) return;
  if (d.t === 'i') {
    if (d.s !== G.seq) return;
    if (d.tp === p.tp) {
      if (!p.down && p.ride < 0) { p.x = d.x; p.y = d.y; }
      // гость за рулём — двигает спидер
      if (d.v && p.ride >= 0) {
        const s = G.speeders.find((q) => q.id === d.v[0]);
        if (s && s.seats[0] === p.idx) { s.x = d.v[1]; s.y = d.v[2]; s.a = d.v[3]; s.vx = d.v[4]; s.vy = d.v[5]; }
      }
    }
    const now = performance.now();
    if (p.lastIn) trackVelocity(p, Math.min(0.2, (now - p.lastIn) / 1000));
    else { p.px = p.x; p.py = p.y; }
    p.lastIn = now;
    p.a = d.a; p.dash = d.d ? 0.05 : 0; p.mv = d.m | 0; p.lamp = !!d.l; p.useId = d.u | 0; p.rad = !!d.r;
  } else if (d.t === 'a') {
    if (d.s !== G.seq) return;
    handleAction(p, d);
  } else if (d.t === 'r') {
    if (G.state === 'over') restartFromCheckpoint();
  } else if (d.t === 'hub') {
    if (G.state === 'over') returnToHub(false);
  }
}

function onHello(c, d) {
  const name = String(d.name || 'Боец').slice(0, 16);
  let idx = -1;
  if (G.state === 'lobby') idx = Lobby.slots.findIndex((s) => !s.human);
  else {
    // игра идёт: человек занимает место бота
    const bot = G.players.find((p) => p.bot && !Net.conns.has(p.idx));
    if (bot) idx = bot.idx;
  }
  if (idx < 0) { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); return; }
  c.idx = idx;
  Net.conns.set(idx, c);
  Object.assign(Lobby.slots[idx], { human: true, name, peer: d.peer || c.peer, ready: false });
  const p = pById(idx);
  if (p) {
    p.bot = false; p.net = true; p.name = name;
    Lobby.slots[idx].ch = p.ch;
    G.toast = { text: `${name} ЗАНИМАЕТ МЕСТО ${CHARS[p.ch].letter}`, t: 3 };
  }
  c.send({ t: 'welcome', idx, state: G.state === 'lobby' ? 'lobby' : 'play', code: Net.code });
  lobbyChanged();
}

function onGuestLeft(c) {
  if (c.idx === undefined || Net.conns.get(c.idx) !== c) return;
  const idx = c.idx;
  Net.conns.delete(idx);
  const name = Lobby.slots[idx].name;
  Object.assign(Lobby.slots[idx], { human: false, name: '', ready: false, peer: '' });
  if (G.state === 'lobby') Lobby.slots[idx].ch = -1;
  const p = pById(idx);
  if (p) {
    // место снова занимает бот
    p.bot = true; p.net = false; p.name = 'БОТ'; p.bot2 = {};
    G.toast = { text: `${name || 'ИГРОК'} ОТКЛЮЧИЛСЯ — ЕГО МЕСТО ЗАНЯЛ БОТ`, t: 3 };
  }
  lobbyChanged();
}

function pickChar(idx, ch) {
  const slot = Lobby.slots[idx];
  if (ch === slot.ch) { slot.ch = -1; slot.ready = false; lobbyChanged(); return; }
  if (ch < 0 || ch > 3 || Lobby.slots.some((s) => s.ch === ch && s.human)) return;   // персонажи не повторяются
  slot.ch = ch;
  lobbyChanged();
}

function lobbyChanged() {
  if (G.role === 'host') {
    broadcast({ t: 'lobby', slots: Lobby.slots, code: Net.code });
    const roster = Lobby.slots.filter((s) => s.human && s.peer).map((s) => ({ idx: s.idx, peer: s.peer }));
    broadcast({ t: 'roster', list: roster });
    Voice.setRoster(roster);
  }
  if (G.state === 'lobby') renderLobby();
}

// Хост/соло: начать игру. Свободные персонажи достаются ботам.
function startGameFromLobby() {
  const humansIn = Lobby.slots.filter((s) => s.human);
  if (humansIn.some((s) => s.ch < 0)) return;
  if (G.role === 'host' && humansIn.some((s) => !s.ready && s.idx !== 0)) return;
  const taken = new Set(humansIn.map((s) => s.ch));
  const freeChars = [0, 1, 2, 3].filter((c) => !taken.has(c));
  G.players = [];
  for (const s of Lobby.slots) {
    if (s.human) {
      const p = makePlayer(s.idx, s.ch, false, s.name);
      p.net = s.idx !== G.myIdx;
      G.players.push(p);
    } else {
      const ch = freeChars.shift();
      s.ch = ch;
      G.players.push(makePlayer(s.idx, ch, true, 'БОТ'));
    }
  }
  G.progress = G.progress || loadProgress();
  hideMenu();
  startStage(0, 0);
  if (G.role === 'host') broadcast({ t: 'start' });
}

function sendSnapshot() {
  const m = G.m;
  const msg = {
    t: 's', s: G.seq, lv: G.lv, st: G.stage, gs: G.state, cp: G.cp, m: m ? packFlags(m) : 0,
    ts: G.toast ? [G.toast.text, r2(G.toast.t)] : 0, lt: r2(G.loudT), fd: r2(G.fadeT || 0), br: G.brief ? 1 : 0,
    pr: G.progress.map((q) => [q.done ? 1 : 0, q.best]),
    p: G.players.map((p) => [p.idx, p.ch, p.bot ? 1 : 0, r1(p.x), r1(p.y), r2(p.a), p.hp, p.down ? 1 : 0, r2(p.revive), p.mv,
      p.lamp ? 1 : 0, p.ride, p.flashT > 0 ? 1 : 0, r2(p.useP), p.rad ? 1 : 0, p.name, p.tp | 0, p.dash > 0 ? 1 : 0]),
    e: G.enemies.map(enemyState),
    al: G.allies.map((a) => [a.id, a.t, r1(a.x), r1(a.y), r2(a.a), a.dead ? 1 : 0, r2(a.hp / a.maxHp), a.flash > 0 ? 1 : 0, a.captain ? 1 : 0, a.tech ? 1 : 0]),
    b: G.bullets.map((b) => [r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), b.side === 'e' ? 0 : b.side === 'a' ? 2 : 1, b.o]),
    g: G.nades.map((n) => [r1(n.x), r1(n.y), r2(n.t), n.kind]),
    o: G.objs.filter((o) => o.k !== 'bush' && o.k !== 'fire').map(objState),
    v: G.speeders.map((s) => [s.id, r1(s.x), r1(s.y), r2(s.a), r1(s.vx), r1(s.vy), s.seats[0], s.seats[1]]),
    fx: G.fxOut,
  };
  broadcast(msg);
  G.fxOut = [];
}

const ZONES = ['', 'out', 'cen', 'tun', 'cave', 'valley'];
function enemyState(e) {
  const bits = (e.wind > 0 ? 1 : 0) | (e.flash > 0 ? 2 : 0) | (e.stun > 0 ? 4 : 0) | (e.mark > 0 ? 8 : 0) | (e.leave ? 16 : 0) |
    (e.flashT > 0 ? 32 : 0) | (e.fear > 0 ? 64 : 0) | (e.silent ? 128 : 0);
  const s = [e.id, e.t, r1(e.x), r1(e.y), r2(e.a), e.dead ? 1 : 0, e.st, bits, r2(e.alertT), r2(e.susT), r2(e.hp / e.maxHp),
    Math.max(0, ZONES.indexOf(e.zone)), r2(e.alarmT)];
  if (ETYPES[e.t].boss) s.push(['gun', 'jam', 'arm'].indexOf(e.bst), r2(e.heat), r2(e.spin), e.over, e.off ? 1 : 0);
  if (e.patrol && G.m && G.m.patrolMap) s.push(e.patrol.map((q) => [r1(q.x), r1(q.y)]));
  return s;
}

// ---------- Гость ----------
function joinGame(code) {
  if (!peerAvailable()) return;
  code = code.trim().toUpperCase();
  if (code.length !== 5) { setStatus('Введите 5-значный код комнаты'); return; }
  cleanupNet();
  setStatus('Подключаемся…');
  const peer = new Peer(undefined, { debug: 1 });
  Net.peer = peer;
  peer.on('call', (call) => Voice.onIncoming(call));
  peer.on('open', (myId) => {
    const c = peer.connect(PEER_PREFIX + code, { reliable: true });
    Net.conn = c;
    const timeout = setTimeout(() => {
      if (!Net.connected) { setStatus('Не удалось подключиться (таймаут). Проверьте код.'); cleanupNet(); }
    }, 12000);
    c.on('open', () => c.send({ t: 'hello', name: G.myName, peer: myId }));
    c.on('data', (d) => {
      if (!d || typeof d !== 'object') return;
      if (d.t === 'full') { setStatus('Комната заполнена'); clearTimeout(timeout); cleanupNet(); return; }
      if (d.t === 'welcome') {
        clearTimeout(timeout);
        Net.connected = true; Net.code = code;
        G.role = 'guest'; G.myIdx = d.idx;
        G.players = []; G.lv = -1; G.seq = -1; G.stage = -1;
        if (d.state === 'lobby') enterLobby();
        else { G.state = 'play'; hideMenu(); }
        return;
      }
      if (G.role !== 'guest') return;
      if (d.t === 'lobby') { Lobby.slots = d.slots; if (G.state === 'lobby') renderLobby(); }
      else if (d.t === 'roster') Voice.setRoster(d.list);
      else if (d.t === 'start') { G.state = 'play'; hideMenu(); }
      else if (d.t === 's') applySnapshot(d);
    });
    c.on('close', () => { if (G.role === 'guest') leaveToMenu('Соединение с хостом потеряно'); });
  });
  peer.on('error', (e) => {
    if (e.type === 'peer-unavailable' && G.role === 'guest') return;     // звонок ушедшему
    if (e.type === 'peer-unavailable') setStatus('Комната не найдена. Проверьте код.');
    else setStatus('Ошибка сети: ' + e.type);
    if (G.role === 'guest') leaveToMenu('Ошибка сети: ' + e.type);
    else cleanupNet();
  });
}

function guestSendInput() {
  const p = me();
  if (!p) return;
  const s = p.ride >= 0 ? G.speeders.find((q) => q.id === p.ride) : null;
  const v = s && s.seats[0] === p.idx ? [s.id, r1(s.x), r1(s.y), r2(s.a), r1(s.vx), r1(s.vy)] : 0;
  send({ t: 'i', s: G.seq, x: r1(p.x), y: r1(p.y), a: r2(p.a), d: p.dash > 0 ? 1 : 0, m: p.mv, l: p.lamp ? 1 : 0,
    u: p.useId | 0, r: p.rad ? 1 : 0, v, tp: p.tp | 0 });
}

function applySnapshot(s) {
  if (s.lv !== G.lv || s.st !== G.stage || s.s !== G.seq) {
    G.lv = s.lv; G.stage = s.st; G.seq = s.s;
    fieldCache.clear();
    buildStageMap(s.lv, s.st);
    spawnObjects();
    resetWorldLists();
    G.enemies = []; G.allies = [];
    G.titleT = 3.5;
    G.newStage = true;
  }
  G.cp = s.cp;
  G.m = s.m ? unpackFlags(s.m) : null;
  G.progress = s.pr.map(([done, best]) => ({ done: !!done, best }));
  if (s.ts && (!G.toast || G.toast.text !== s.ts[0])) G.toast = { text: s.ts[0], t: s.ts[1] };
  G.state = s.gs; G.loudT = s.lt; G.fadeT = s.fd;
  if (!s.br) G.brief = null;      // у хоста брифинг закончился — мир снова идёт

  // герои
  const seen = new Set();
  for (const [idx, ch, bot, x, y, a, hp, down, rv, mv, lamp, ride, fl, useP, rad, name, tp, dash] of s.p) {
    seen.add(idx);
    let p = pById(idx);
    if (!p) {
      p = makePlayer(idx, ch, !!bot, name);
      p.x = p.rx = x; p.y = p.ry = y; p.tp = tp;
      if (idx !== G.myIdx) p.net = true;
      G.players.push(p);
      if (idx === G.myIdx) { G.cam.x = x; G.cam.y = y; }
    }
    p.ch = ch; p.bot = !!bot; p.name = name; p.hp = hp; p.down = !!down; p.revive = rv; p.ride = ride; p.useP = useP;
    if (idx === G.myIdx) {
      // хост переставил героя (новый этап, высадка, перезапуск)
      if (tp !== p.tp || G.newStage) { p.tp = tp; p.x = p.rx = x; p.y = p.ry = y; G.cam.x = x; G.cam.y = y; }
    } else {
      p.x = x; p.y = y; p.a = a; p.mv = mv; p.lamp = !!lamp; p.flashT = fl ? 0.1 : 0; p.rad = !!rad; p.dash = dash ? 0.05 : 0;
    }
  }
  G.players = G.players.filter((p) => seen.has(p.idx));
  G.newStage = false;

  const byId = new Map(G.enemies.map((e) => [e.id, e]));
  G.enemies = s.e.map((q) => {
    const [id, t, x, y, a, dead, st, bits, alertT, susT, hpf, z, alarmT] = q;
    let e = byId.get(id);
    if (!e) e = { id, t, rx: x, ry: y, maxHp: ETYPES[t].hp };
    Object.assign(e, { x, y, a, dead: !!dead, st, wind: bits & 1 ? 0.1 : 0, flash: bits & 2 ? 0.05 : 0, stun: bits & 4 ? 0.1 : 0,
      mark: bits & 8 ? 1 : 0, leave: !!(bits & 16), flashT: bits & 32 ? 0.1 : 0, fear: bits & 64 ? 1 : 0, silent: !!(bits & 128),
      alertT, susT, hp: hpf * ETYPES[t].hp, zone: ZONES[z], alarmT });
    let k = 13;
    if (ETYPES[t].boss) { e.bst = ['gun', 'jam', 'arm'][q[13]]; e.heat = q[14]; e.spin = q[15]; e.over = q[16]; e.off = !!q[17]; e.armless = e.bst === 'arm'; k = 18; }
    if (q[k]) e.patrol = q[k].map(([px, py]) => ({ x: px, y: py }));
    return e;
  });
  const alById = new Map(G.allies.map((a) => [a.id, a]));
  G.allies = s.al.map(([id, t, x, y, a, dead, hpf, flash, captain, tech]) => {
    let al = alById.get(id);
    if (!al) al = { id, t, rx: x, ry: y };
    Object.assign(al, { x, y, a, dead: !!dead, hp: hpf * ATYPES[t].hp, maxHp: ATYPES[t].hp, flash: flash ? 0.05 : 0, captain: !!captain, tech: !!tech });
    return al;
  });
  G.bullets = s.b.map(([x, y, vx, vy, side, o]) => ({ x, y, vx, vy, side: side === 0 ? 'e' : side === 2 ? 'a' : 'p', o }));
  G.nades = s.g.map(([x, y, t, kind]) => ({ x, y, t, kind }));
  for (const st of s.o) { const o = objById(st[0]); if (o) applyObjState(o, st); }
  const mine = me();
  for (const [id, x, y, a, vx, vy, s0, s1] of s.v) {
    const sp = G.speeders.find((q) => q.id === id);
    if (!sp) continue;
    const driving = mine && s0 === mine.idx && sp.seats[0] === mine.idx && sp.local;
    sp.seats = [s0, s1];
    if (!driving) { sp.x = x; sp.y = y; sp.a = a; sp.vx = vx; sp.vy = vy; sp.local = false; }
  }
  for (const ev of s.fx) playFx(ev, true);
}

function cleanupNet() {
  Voice.cleanup();
  try { if (Net.conn) Net.conn.close(); } catch (e) { /* ignore */ }
  for (const c of Net.conns.values()) { try { c.close(); } catch (e) { /* ignore */ } }
  try { if (Net.peer) Net.peer.destroy(); } catch (e) { /* ignore */ }
  Net.conn = null; Net.peer = null; Net.connected = false; Net.code = ''; Net.conns.clear();
}

function leaveToMenu(msg) {
  cleanupNet();
  G.role = 'none'; G.state = 'menu';
  G.players = []; G.enemies = []; G.allies = []; G.bullets = []; G.nades = []; G.objs = []; G.speeders = [];
  G.m = null; G.ui = null; G.brief = null;
  map = null;
  showMenu();
  setStatus(msg || '');
}
