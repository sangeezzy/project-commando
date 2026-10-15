'use strict';
// ---------- Сеть: кооператив до 4 игроков, прямое подключение к серверу хоста (server.ps1 / server.py) ----------
// Хост авторитетен: противники, союзные боты, пули, урон, двери, ключи. Звезда: каждый гость связан с хостом через его сервер.
// Гость сам двигает своего бойца (позиция, взгляд, стойка, наклон) и шлёт хосту ввод; курок и действия выполняет хост.
// Основа — сеть прототипа Commando (archive/commando/js/net.js).

// Частота обмена (хост → гости снимки, гость → хост ввод)
const NET_HZ = 60;
const netRate = () => 1000 / NET_HZ;

const Net = {
  conn: null, conns: new Map(), code: '', sendT: 0, connected: false,
  ws: null, wsConns: new Map(), addrs: [],
  inp: { fire: false, press: 0, acts: [] },     // гость: накопленный ввод до следующего пакета
  left: {},                                     // хост: кто вышел посреди игры (имя → место) — для переподключения
  rejoin: null,                                 // гость: куда переподключаться при обрыве ({ tg, tries })
  ping: {},                                     // пинг каждого гостя (место → мс, туда и обратно): меряет хост, рассылает всем
  pingT: 0, snapN: 0, snapHz: 0, rateT: 0,      // гость: снимков за секунду
};

// Лобби: size мест (2–8, выбирает хост / одиночка в главном меню); human — занято человеком; ready — нажал «Готов»
const SQUAD_MIN = 2, SQUAD_MAX = 8;
const Lobby = { slots: [], bots: true, size: 4, ff: true, botGuns: true };   // botGuns — случайное оружие у ботов (иначе только пистолет)     // ff — огонь по своим (решает хост в лобби; ffBlocked в weapon.js)
const emptySlots = (n = Lobby.size) => Array.from({ length: clamp(n | 0, SQUAD_MIN, SQUAD_MAX) }, (_, slot) => ({ slot, human: false, name: '', ready: false }));

function send(msg) {
  if (Net.conn && Net.conn.open) { try { Net.conn.send(msg); } catch (e) { /* канал закрыт */ } }
}
function broadcast(msg) {
  // через сервер — одно сообщение «всем гостям» (A|) вместо копии каждому: меньше трафика у хоста
  if (Net.ws && Net.ws.readyState === 1 && [...Net.conns.values()].some((c) => c.open)) Net.ws.send('A|' + JSON.stringify(msg));
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
  if (d.t === 'po') {
    const rtt = performance.now() - d.c;
    if (rtt >= 0 && rtt < 10000) Net.ping[slot] = Net.ping[slot] == null ? rtt : Net.ping[slot] * 0.5 + rtt * 0.5;
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
  // гость за рулём: машину ведёт он — хост берёт её позу
  if (d.vh && p.veh && p.seat === 0 && p.veh.id === d.vh[0]) {
    const c = p.veh;
    c.remote = true;
    if (c.parked) unparkCar(c);
    [, c.x, c.y, c.a, c.vx, c.vy, c.steer] = d.vh;
    c.ctrl = { thr: d.vh[7], steer: 0, hb: 0 };
    if (d.vh[8] > 0) engineDamage(c, d.vh[8]);          // удар передом у гостя — урон двигателю
    if (d.vh[9] > 0) emit(['crash', c.x, c.y, d.vh[9]]);
  }
}

// Курок гостя: удержание — как у своего, нажатия для одиночного огня копятся
function applyRemoteFire(p) {
  const pressedNow = (p.inPress || 0) > 0;
  pullTrigger(p, p.inFire || pressedNow, pressedNow, playerSpread(p));
  if (pressedNow) p.inPress--;
}

// Гость представился. В лобби — первое свободное место. В идущей игре (вход или переподключение) — прежнее место
// по имени (Net.left), иначе место живого бота, иначе любое свободное; бот на месте отдаёт бойца человеку.
function onHello(c, d) {
  const name = String(d.name || 'Боец').slice(0, 16);
  if (d.v !== GAME_VERSION) { c.send({ t: 'version', v: GAME_VERSION }); setTimeout(() => c.close(), 300); return; }
  const inGame = G.state !== 'lobby';
  const free = (s) => !Lobby.slots[s].human;
  let slot = -1;
  if (!inGame) slot = Lobby.slots.findIndex((s) => !s.human);
  else {
    // то же имя ещё числится подключённым — старое соединение зависло (обрыв ещё не замечен): освободить место
    const dup = Lobby.slots.findIndex((s) => s.slot !== 0 && s.human && s.name === name);
    const old = dup > 0 && Net.conns.get(dup);
    if (old && old !== c) { onGuestLeft(old); try { old.close(); } catch (e) { /* ignore */ } }
    const back = Net.left[name];
    if (back != null && free(back)) slot = back;
    const all = Lobby.slots.map((s) => s.slot);
    if (slot < 0) slot = all.find((s) => free(s) && G.players.some((q) => q.slot === s && q.ai && !q.dead)) ?? -1;
    if (slot < 0) slot = all.find(free) ?? -1;
  }
  if (slot < 0) { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); return; }
  c.slot = slot; c.op = !!d.op;
  Net.conns.set(slot, c);
  Object.assign(Lobby.slots[slot], { human: true, name, ready: inGame });
  c.send({ t: 'welcome', slot, code: Net.code });
  if (inGame) {
    const back = Net.left[name] === slot;
    takeSlot(slot, name);
    c.send({ t: 'start' });
    toast(`${name} ${back ? 'вернулся' : 'присоединился'}`, 3);
  }
  delete Net.left[name];
  lobbyChanged();
}

// Вошедший в идущую игру человек занимает место: бот на нём становится человеком (с его здоровьем, патронами, местом),
// а если бойца на месте нет (боты выключены) — новый боец рядом с отрядом. Место остаётся за человеком и при перезапуске.
function takeSlot(slot, name) {
  let p = G.players.find((q) => q.slot === slot);
  if (p) Object.assign(p, { ai: false, name, net: false, target: null, goal: null, peek: null, flank: null, fm: null, role: null, kneel: false });
  else {
    const lead = G.players.find((q) => !q.dead && !q.ai) || G.players.find((q) => !q.dead) || { x: map.start.x * TILE, y: map.start.y * TILE, a: -Math.PI / 2 };
    const spot = freeSpotNear(lead.x + TILE, lead.y, PR) || { x: lead.x, y: lead.y };
    p = makeHuman(slot, spot.x, spot.y, lead.a ?? -Math.PI / 2, name);
    if (G.kits) giveKit(p, null, null, randomPistol());          // новый боец в сессии — как все на старте: только пистолет
    G.players.push(p);
  }
  // снаряжение места — то, с чем вошёл (тело бота или пистолет): дальше — на каждой карте, пока не сменит на столе
  if (G.kits && !G.kits[slot]) G.kits[slot] = [p.kit[0] ? p.kit[0].t : null, p.kit[1] ? p.kit[1].t : null, p.kit[2] ? p.kit[2].t : 'm1911', p.armor ? p.armor.cls : null];
  G.lastSquad = [...(G.lastSquad || []).filter((q) => q.slot !== slot), { slot, human: true, name }];
}

function onGuestLeft(c) {
  if (c.slot === undefined || Net.conns.get(c.slot) !== c) return;
  const slot = c.slot;
  Net.conns.delete(slot);
  delete Net.ping[slot];
  const name = Lobby.slots[slot].name;
  if (G.state !== 'lobby') Net.left[name] = slot;        // вернётся под тем же именем — получит своё место
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
  if (G.role === 'host') {
    // голос — Opus, если его умеют все в комнате (иначе μ-law)
    Voice.useOpus = Voice.opusOk && [...Net.conns.values()].every((k) => k.op);
    broadcast({ t: 'lobby', slots: Lobby.slots, bots: Lobby.bots, ff: Lobby.ff ? 1 : 0, bg: Lobby.botGuns ? 1 : 0, code: Net.code, addrs: Net.addrs, vop: Voice.useOpus ? 1 : 0 });
  }
  if (G.state === 'lobby') renderLobby();
}

const lobbyReady = () => Lobby.slots.filter((s) => s.human).every((s) => s.ready);

// Хост/одиночка: начать, когда все люди готовы. Пустые места — ботам (если включено).
function startGameFromLobby() {
  if (G.role === 'guest' || !lobbyReady()) return;
  const squad = Lobby.slots.filter((s) => s.human).map((s) => ({ slot: s.slot, human: true, name: s.name }));
  hideMenu();
  G.lastSquad = squad; G.lastBots = Lobby.bots;
  G.squadSize = Lobby.slots.length;      // мест в отряде: пустые — боты (если включены)
  // снаряжение на старте: людям — только случайный пистолет (остальное — на оружейном столе в хабе); ботам — по галочке:
  // случайное или только случайный пистолет (сменить можно на столе — G.botKits)
  G.kits = {};
  for (const s of squad) G.kits[s.slot] = [null, null, randomPistol(), null];
  G.botKits = {}; G.botsRandom = Lobby.botGuns;
  launchMap('hub', 0);                    // после лобби — хаб: оружейный стол и проходы на карты
}

// ---------- Снимок мира (хост → гости) ----------
const ACTS = ['unlock', 'kick', 'supply', 'heal'];
function personState(o) {
  const g = o.gun;
  const flags = (o.dead ? 1 : 0) | (o.crouch ? 2 : 0) | (o.sprint ? 4 : 0) | (o.lamp ? 8 : 0) | (o.kneel ? 16 : 0) |
    (o.ai ? 32 : 0) | (o.seeing ? 64 : 0) | (o.down ? 128 : 0) | (o.god ? 256 : 0);
  const s = [o.id, o.side === 'e' ? 1 : 0, o.slot, flags, r1(o.x), r1(o.y), r2(o.a), Math.ceil(o.hp), r2(o.ads || 0), r2(o.leanPx || 0),
    o.st | 0, r2(o.notice || 0), r2(o.deadA || 0), r2(g.reloadT), r2(g.reloadDur),
    o.act ? [ACTS.indexOf(o.act.kind), r2(o.act.t), r2(o.act.dur)] : 0,
    // снаряжение: стволы по слотам (номер в WEAPON_IDS, −1 — пусто), в руках, в левой руке, смена (куда, сколько, всего), нож (−1 — нет)
    [...o.kit.map((k) => (k ? WEAPON_IDS.indexOf(k.t) : -1)), o.cur, o.off, o.sw ? o.sw.to : -1, o.sw ? r2(o.sw.t) : 0, o.sw ? r2(o.sw.dur) : 0,
      o.melee ? r2(o.melee.t) : -1],
    o.armor ? [ARMOR_ORDER.indexOf(o.armor.cls), Math.round(o.armor.hp)] : 0];       // броня: класс и прочность
  if (o.side === 'p') s.push(o.name, o.kit.map((k) => (k ? [k.mag, k.chamber, k.pouch, WEAPONS[k.t].modes.indexOf(k.mode), (k.reloadEmpty ? 1 : 0) | (k.quick ? 2 : 0)] : 0)),
    [...o.keys], r2(o.supp), r2(o.bleed || 0), r2(o.rev || 0), o.reviving || 0, o.lastReviver || 0);
  return s;
}

// Снаряжение из снимка: стволы по слотам (новый тип — новый объект), что в руках, смена, нож
function applyKit(o, ki) {
  for (let i = 0; i < 3; i++) {
    const t = ki[i] >= 0 ? WEAPON_IDS[ki[i]] : null;
    if (!t) o.kit[i] = null;
    else if (!o.kit[i] || o.kit[i].t !== t) o.kit[i] = makeGun(t);
  }
  o.cur = ki[3]; o.off = ki[4];
  o.sw = ki[5] >= 0 ? { to: ki[5], t: ki[6], dur: ki[7] } : null;
  o.melee = ki[8] >= 0 ? { t: ki[8], dur: KNIFE.dur, hit: true } : null;
  o.gun = o.kit[o.cur] || o.kit[2];
}

function sendSnapshot() {
  broadcast({
    t: 's', seq: G.seq, gs: G.state, tm: Math.round(performance.now()),     // tm — время хоста: гость по нему интерполирует
    map: G.mapId, seed: G.mapSeed, hh: G.hubHold ? [G.hubHold.i, r2(G.hubHold.t)] : 0,   // карта и счёт перехода в хабе
    wx: weatherState(), vs: sightM(), sv: survState(),      // погода и «Выживание» (волна, грузовик, медик)
    P: allPeople().map(personState),
    D: map.doors.map((d) => (d.open ? 1 : 0) | (d.locked ? 2 : 0) | (d.broken ? 4 : 0)),
    K: map.keys.map((k) => (k.taken ? 1 : 0)),
    M: (map.mgs || []).map(mgState),          // стационарные пулемёты: тип, место, кто за ним, лента
    V: (map.cars || []).map(carState),         // машины: поза, скорость, руль, двигатель, стоянка, кто где сидит
    fx: G.fxOut,
  });
  G.fxOut = [];
}

// ---------- Гость ----------
// Сообщение от хоста
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
  if (d.t === 'pg') { send({ t: 'po', c: d.c }); return; }         // пинг: вернуть метку хоста сразу
  if (d.t === 'pings') { Net.ping = d.v || {}; if (G.state === 'lobby') renderLobby(); return; }
  if (d.t === 'welcome') {
    clearTimeout(timeout);
    Net.connected = true; Net.code = code;
    G.role = 'guest'; G.mySlot = d.slot; G.seq = -1;
    const voice = Net.rejoin && Net.rejoin.voice;
    Net.rejoin = Net.rejoinTo ? { ...Net.rejoinTo, tries: 0 } : null;
    enterLobby();
    if (voice) Voice.enable();          // переподключился — голос как был
    return;
  }
  if (G.role !== 'guest') return;
  if (d.t === 'lobby') {
    Lobby.slots = d.slots; Lobby.bots = d.bots; Lobby.ff = d.ff !== 0; Lobby.botGuns = d.bg !== 0; Net.addrs = d.addrs || Net.addrs; Voice.useOpus = !!d.vop && Voice.opusOk;
    if (G.state === 'lobby') renderLobby();
  }
  else if (d.t === 'start') { hideMenu(); if (G.state === 'lobby') G.state = 'play'; }
  else if (d.t === 's') applySnapshot(d);
}

// ---------- Прямое подключение: WebSocket через сервер хоста (server.ps1 / server.py) ----------
// Хост открывает игру со своего сервера («Играть.bat»), гости — по адресу хоста: в локальной сети / Radmin VPN и т. п. (http://IP:8000).
// Сервер только пересылает сообщения. Обмен с сервером: заголовок + JSON игры (серверу не нужно разбирать JSON) — см. server.py.
const servedByServer = () => location.protocol === 'http:' || location.protocol === 'https:';

// Адрес → ссылка WebSocket: схема (http://) и путь отбрасываются, без порта — порт 8000 (кроме адреса этой страницы)
function wsTarget(input) {
  const s0 = (input || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '');
  if (!s0) return null;
  const s = s0 === location.host || /:\d+$/.test(s0) ? s0 : s0 + ':8000';
  return { url: (s === location.host && location.protocol === 'https:' ? 'wss://' : 'ws://') + s + '/ws', host: s };
}

// Приложение для телефона (dev/android): сервер игры — внутри приложения (window.CommandoApp, GameServer.java)
const appServer = () => (window.CommandoApp && typeof CommandoApp.startServer === 'function' ? CommandoApp : null);

function hostLocal() {
  const app = appServer();
  if (app) {
    let r;
    try { r = JSON.parse(app.startServer()); } catch (e) { r = { ok: false, err: String(e) }; }
    if (!r.ok) { setStatus('Не удалось запустить сервер на телефоне: ' + r.err); return; }
    hostWs(wsTarget('127.0.0.1:' + r.port));
    return;
  }
  if (!servedByServer()) {
    setStatus('Для игры по сети запустите игру через «Играть.bat» — она откроется по адресу http://localhost:8000.');
    return;
  }
  hostWs(wsTarget(location.host));
}

// Хост: комната на своём сервере
function hostWs(tg) {
  cleanupNet();
  setStatus(appServer() ? 'Создаём комнату на этом телефоне…' : 'Создаём комнату на этом компьютере…');
  let ws;
  try { ws = new WebSocket(tg.url); } catch (e) { setStatus('Неверный адрес сервера: ' + tg.host); return; }
  Net.ws = ws;
  const timeout = setTimeout(() => {
    if (Net.ws === ws && G.role !== 'host') { setStatus(`Сервер ${tg.host} не отвечает — окно сервера («Играть.bat») открыто?`); cleanupNet(); }
  }, 10000);
  ws.onopen = () => ws.send('H');
  ws.onmessage = (ev) => {
    const m = String(ev.data), k = m[0];
    if (k === 'E') {
      clearTimeout(timeout);
      const err = m.slice(2);
      cleanupNet();
      setStatus(err !== 'host-exists' ? 'Ошибка сервера: ' + err : 'На этом сервере комната уже создана (игра открыта в другой вкладке?).');
    } else if (k === 'O') {
      clearTimeout(timeout);
      Net.addrs = m.slice(2) ? m.slice(2).split(',') : [];
      G.role = 'host'; G.mySlot = 0;
      Lobby.slots = emptySlots();
      Object.assign(Lobby.slots[0], { human: true, name: G.myName });
      enterLobby();
      sendRoomInfo();
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
  ws.onclose = (ev) => {
    if (Net.ws !== ws) return;
    clearTimeout(timeout);
    if (G.role === 'host') leaveToMenu('Связь с сервером игры потеряна — окно сервера («Играть.bat») закрыто?');
    else { setStatus(`Сервер игры не отвечает — запустите «Играть.bat». (код ${ev.code})`); cleanupNet(); }
  };
}

// Хост: о комнате — серверу для списка локальных серверов (GET /info): позывной, игроков, мест, версия, где отряд
function sendRoomInfo() {
  const ws = Net.ws;
  if (G.role !== 'host' || !ws || ws.readyState !== 1) return;
  const h = Lobby.slots.filter((s) => s.human).length;
  ws.send('I|' + JSON.stringify({ n: G.myName, h, s: Lobby.slots.length, v: GAME_VERSION, m: G.state === 'lobby' ? '' : G.mapId || '' }));
}

// Гость на сервере хоста — для кода хоста выглядит как отдельное соединение (send, close, open)
function wsConn(ws, id) {
  return {
    id, open: true,
    send(d) { if (ws.readyState === 1) ws.send('T' + id + '|' + JSON.stringify(d)); },
    close() { if (ws.readyState === 1) ws.send('K' + id); this.open = false; },
  };
}

function joinLocal(addr) {
  const tg = wsTarget(addr);
  if (!tg) { setStatus('Введите адрес хоста: 192.168.1.5:8000 или 26.x.x.x:8000'); return; }
  joinWs(tg);
}

// Гость: к серверу хоста
function joinWs(tg) {
  cleanupNet();
  setStatus(`Подключаемся к ${tg.host}…`);
  let ws;
  try { ws = new WebSocket(tg.url); } catch (e) { setStatus('Неверный адрес: ' + tg.host); return; }
  Net.ws = ws;
  Net.rejoinTo = { tg };
  const conn = {
    open: false,
    send(d) { if (ws.readyState === 1) ws.send('M|' + JSON.stringify(d)); },
    close() { try { ws.close(); } catch (e) { /* ignore */ } },
  };
  Net.conn = conn;
  const hint = 'Хост запустил «Играть.bat»? Адрес открывается в браузере? Фаервол хоста разрешил доступ?';
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
      const err = m.slice(2);
      setStatus(err === 'no-host' ? 'Сервер найден, но комнаты ещё нет: хост должен нажать «Создать комнату на этом компьютере».'
        : err === 'full' ? 'Комната заполнена' : 'Ошибка сервера: ' + err);
      cleanupNet();
    } else if (k === 'W') {
      conn.open = true;
      conn.send({ t: 'hello', name: G.myName, v: GAME_VERSION, op: Voice.opusOk ? 1 : 0 });
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
    if (G.role === 'guest') guestLost('Соединение с хостом потеряно');
    else if (!Net.connected) { setStatus(`Не удалось подключиться к ${tg.host}. ${hint}`); cleanupNet(); }
  };
}

function guestSendInput() {
  Net.inp.sentFire = Net.inp.fire; Net.inp.sentF = !!keys.KeyF;
  const p = me();
  if (!p || p.dead) { Net.inp.acts = []; Net.inp.press = 0; return; }   // раненый тоже шлёт: ползёт
  send({ t: 'i', seq: G.seq, x: r1(p.x), y: r1(p.y), a: r2(p.a), c: p.crouch ? 1 : 0, ads: r2(p.ads), lw: p.leanWant | 0,
    sp: p.sprint ? 1 : 0, sl: r2(p.sprintLock), v: r1(p.speed), f: Net.inp.fire ? 1 : 0, pr: Net.inp.press, acts: Net.inp.acts,
    hf: keys.KeyF ? 1 : 0,
    // за рулём — поза своей машины (гость считает её сам, как своего бойца)
    vh: p.veh && p.seat === 0 ? vehInput(p.veh) : 0 });
  Net.inp.press = 0; Net.inp.acts = [];
}

// Новый запуск полигона у хоста — пересобрать мир у себя
function resetGuestWorld(seq, id = 'range', seed = 0) {
  G.mapId = id; G.mapSeed = seed; G.surv = null; G.weather = null;
  buildMap(id, seed);
  map.mgs = [];
  initVehicles();
  G.seq = seq;
  G.players = []; G.enemies = []; G.bullets = []; G.parts = []; G.decals = []; G.hurt = [];
  G.hitmark = null; G.toast = null; G.muzzle = []; G.expo = null; G.barks = [];
  if (id !== 'hub') G.runResult = null;
  fieldCache.clear();
  G.stateT = 0;
  hideMenu();
}

function applySnapshot(s) {
  const fresh = s.seq !== G.seq;
  if (fresh || s.map !== G.mapId) { resetGuestWorld(s.seq, s.map, s.seed); resetInterp(); resetPred(); }
  G.hubHold = s.hh ? { i: s.hh[0], t: s.hh[1] } : null;
  applyWeatherState(s.wx);
  G.netSight = s.vs;
  applySurvState(s.sv);
  const tm = s.tm ?? Math.round(performance.now());
  interpClock(tm);
  Net.snapN++;
  if (G.state !== s.gs) G.stateT = 0;
  G.state = s.gs;
  const mine = G.mySlot;
  const known = new Map(allPeople().map((o) => [o.id, o]));
  const players = [], enemies = [];
  for (const q of s.P) {
    const [id, side, slot, flags, x, y, a, hp, ads, leanPx, st, notice, deadA, reloadT, reloadDur, act, kit, arm] = q;
    let o = known.get(id);
    if (!o) {
      o = makePerson(side ? 'e' : 'p', x, y, a);
      o.id = id; o.slot = slot;
    }
    const own = side === 0 && slot === mine && !(flags & 32);
    const wasDead = o.dead;
    o.dead = !!(flags & 1); o.hp = hp; o.ai = !!(flags & 32); o.st = st; o.notice = notice; o.seeing = !!(flags & 64);
    o.lamp = !!(flags & 8); o.kneel = !!(flags & 16); o.deadA = deadA; o.god = !!(flags & 256);
    if (o.dead && !wasDead) o.deadT = G.time;
    applyKit(o, kit);
    o.armor = arm ? { cls: ARMOR_ORDER[arm[0]], hp: arm[1] } : null;
    o.gun.reloadT = reloadT; o.gun.reloadDur = reloadDur;
    o.act = act ? { kind: ACTS[act[0]], t: act[1], dur: act[2] } : null;
    if (side === 0) {
      const [, , , , , , , , , , , , , , , , , , name, ammo, keysArr, supp, bleed, rev, reviving, lastReviver] = q;
      o.name = name;
      o.down = !!(flags & 128); o.bleed = bleed; o.rev = rev; o.reviving = reviving; o.lastReviver = lastReviver;
      ammo.forEach((m, i) => {
        const k = o.kit[i];
        if (!k || !m) return;
        k.mag = m[0]; k.chamber = m[1]; k.pouch = m[2]; k.mode = WEAPONS[k.t].modes[m[3]]; k.reloadEmpty = !!(m[4] & 1); k.quick = !!(m[4] & 2);
      });
      o.keys = new Set(keysArr); o.supp = supp;
    }
    if (own) {
      // свой боец: позицию и стойку ведём сами; хост переставляет только на новом запуске
      // и после гибели — приехал на грузовике
      if (fresh || (wasDead && !o.dead)) { o.x = o.px = x; o.y = o.py = y; o.a = a; G.cam.x = x; G.cam.y = y; }
    } else {
      if (fresh) o.hist = null;
      interpPush(o, tm, x, y, a);
      o.crouch = !!(flags & 2); o.sprint = !!(flags & 4); o.ads = ads; o.leanPx = leanPx; o.lean = Math.sign(leanPx);
      o.leanSide = Math.sign(leanPx);        // смещение глаз считается от показанного (интерполированного) взгляда
      if (fresh) { o.x = x; o.y = y; o.a = a; }
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
  applyCarState(s.V);                        // после бойцов: машины и кто где сидит (o.veh, o.seat)
  applyMgState(s.M);                         // после бойцов: кто за пулемётом (o.mg, o.gun)
  for (const ev of s.fx) if (!predConsumes(ev)) playFx(ev);
  { const p = me(); if (p && !p.ai) predAmmo(p.gun); }
}

// Отправка по таймеру: хост — снимки, гость — ввод. Таймер накапливается (а не сбрасывается), с допуском в четверть
// интервала: при 60 Гц и кадрах по ~16,7 мс иначе каждый второй кадр пропускался бы из-за дрожания dt.
// Гость шлёт сразу, не дожидаясь таймера: нажатие курка, отпускание, действия (F, G, R, V, L), начало/конец удержания F.
function netTick(dt) {
  if (G.role !== 'host' && G.role !== 'guest') return;
  netStats(dt);
  const ms = netRate();
  Net.sendT -= dt * 1000;
  if (G.role === 'host') {
    if (Net.sendT > ms * 0.25) return;
    if (Net.conns.size && map) sendSnapshot(); else G.fxOut = [];
    Net.sendT = Math.max(Net.sendT + ms, ms * 0.5);
  } else {
    const I = Net.inp;
    const urgent = I.press > 0 || I.acts.length > 0 || I.fire !== I.sentFire || !!keys.KeyF !== I.sentF;
    if (!urgent && Net.sendT > ms * 0.25) return;
    guestSendInput();
    Net.sendT = urgent ? ms : Math.max(Net.sendT + ms, ms * 0.5);
  }
}

// Раз в секунду: хост — метка времени каждому гостю (гость сразу возвращает: пинг без ожидания кадров) и пинги всех — всем;
// гость — сколько снимков пришло за секунду
function netStats(dt) {
  Net.pingT -= dt;
  if (Net.pingT > 0) return;
  Net.pingT = 1;
  if (G.role === 'host') {
    sendRoomInfo();
    const c = Math.round(performance.now() * 10) / 10;
    for (const k of Net.conns.values()) if (k.open) { try { k.send({ t: 'pg', c }); } catch (e) { /* ignore */ } }
    const v = {};
    for (const [s, ms] of Object.entries(Net.ping)) v[s] = Math.round(ms);
    if (Net.conns.size) broadcast({ t: 'pings', v });
  } else {
    Net.snapHz = Net.snapN; Net.snapN = 0;
  }
}
const pingOf = (slot) => (Net.ping[slot] == null ? null : Math.round(Net.ping[slot]));

// ---------- Предсказание своих выстрелов у гостя ----------
// Выстрел считает хост, но ждать его ответа (полный пинг) — стрельба «ватная». Гость сам ведёт темп и сразу показывает
// вспышку, звук, гильзу, отдачу прицела и убыль патронов. Пришедший от хоста тот же выстрел (эффект 'shot' своего бойца)
// подтверждает предсказанный и не играется второй раз; выстрел, которого гость не предсказал, — играется.
// Патроны: из снимка минус ещё не подтверждённые. Не подтверждён за пинг + 0,3 с (хост не выстрелил) — списывается.
const Pred = { cd: 0, q: [] };
function resetPred() { Pred.cd = 0; Pred.q = []; }

function predictFire(p, held, pressedNow) {
  const g = p.gun, W = WEAPONS[g.t];
  if (!held || Pred.cd > 0 || !canShoot(p) || !g.chamber) return;
  if (g.mode === 'semi' && !pressedNow) return;
  Pred.cd += 60 / W.rpm;
  Pred.q.push(performance.now());
  // то же, что fireRound делает со стрелком: патрон, отдача, вспышка — без пули (пулю ведёт хост)
  g.chamber = 0;
  if (g.mag > 0) { g.mag--; g.chamber = 1; }
  g.bloom = Math.min(W.maxBloom, g.bloom + (W.kick + (W.kickHip - W.kick) * (1 - p.ads)) * RECOIL.bloomK);
  g.lastShot = G.time;
  const ox = p.leanPx ? p.lx : p.x, oy = p.leanPx ? p.ly : p.y;
  playFx(['shot', ox + Math.cos(p.a) * M(0.75), oy + Math.sin(p.a) * M(0.75), p.a, p.side, p.id]);
  recoilKick(p);                                  // отдача — у гостя сразу (уведённый взгляд уйдёт хосту во вводе)
}

// Каждый кадр у гостя: темп и отдача своего оружия гаснут; просроченные предсказания списываются
function predTick(p, dt) {
  const W = WEAPONS[p.gun.t];
  Pred.cd = Math.max(-0.02, Pred.cd - dt);
  p.gun.bloom *= Math.exp(-W.recover * dt);
  const ttl = (pingOf(G.mySlot) || 100) + 300, now = performance.now();
  while (Pred.q.length && now - Pred.q[0] > ttl) Pred.q.shift();
}

// Эффект из снимка: свой выстрел, который уже показан предсказанием, — пропустить
function predConsumes(ev) {
  const p = me();
  if (ev[0] !== 'shot' || !p || ev[5] !== p.id || !Pred.q.length) return false;
  Pred.q.shift();
  return true;
}

// Патроны своего оружия из снимка минус выстрелы, которые хост ещё не подтвердил
function predAmmo(g) {
  for (let i = 0; i < Pred.q.length; i++) {
    if (!g.chamber) break;
    g.chamber = 0;
    if (g.mag > 0) { g.mag--; g.chamber = 1; }
  }
}

// ---------- Интерполяция у гостя ----------
// Чужие бойцы показываются чуть в прошлом — между двумя снимками хоста, по его часам (tm), а не догоняют последнюю позицию:
// плавно при любой частоте кадров и без лишнего отставания. Часы хоста: clk — разница «наше время − время хоста»
// (вниз — сразу, вверх — медленно: держится у наименьшей задержки), snapDt — средний интервал снимков.
// jit — средний разброс задержки доставки снимков: на неровной сети запас растёт, на ровной — остаётся малым
const Interp = { clk: null, snapDt: 50, lastTm: 0, jit: 5 };
function interpClock(tm) {
  const s = performance.now() - tm;
  if (Interp.clk === null || s < Interp.clk) Interp.clk = s; else Interp.clk += (s - Interp.clk) * 0.02;
  Interp.jit += (Math.min(200, s - Interp.clk) - Interp.jit) * 0.05;
  if (Interp.lastTm) Interp.snapDt += (clamp(tm - Interp.lastTm, 5, 200) - Interp.snapDt) * 0.1;
  Interp.lastTm = tm;
}
// запас: интервал снимков с небольшим запасом + двойной средний разброс доставки (разброс почти всегда меньше)
const interpDelay = () => Interp.snapDt * 1.2 + 10 + Interp.jit * 2;
const interpTime = () => performance.now() - (Interp.clk || 0) - interpDelay();
function resetInterp() { Interp.clk = null; Interp.snapDt = 50; Interp.lastTm = 0; Interp.jit = 5; }

// Новая точка истории бойца (из снимка); телепорт (> 4 м) — без размазывания
function interpPush(o, t, x, y, a) {
  const h = o.hist || (o.hist = []);
  const last = h[h.length - 1];
  if (last && Math.hypot(last.x - x, last.y - y) > M(4)) h.length = 0;
  if (last && t <= last.t) return;
  h.push({ t, x, y, a });
  if (h.length > 40) h.shift();
}

// Положение бойца на момент t (время хоста): между соседними точками; позже последней — стоит в последней
function interpApply(o, t) {
  const h = o.hist;
  if (!h || !h.length) return;
  while (h.length > 2 && h[1].t <= t) h.shift();               // старые точки больше не нужны
  const A = h[0], B = h[1];
  if (!B || t <= A.t) { const P = B && t > B.t ? B : A; o.x = P.x; o.y = P.y; o.a = P.a; return; }
  const k = Math.min(1, (t - A.t) / (B.t - A.t));
  o.x = A.x + (B.x - A.x) * k; o.y = A.y + (B.y - A.y) * k;
  o.a = A.a + angDiff(B.a, A.a) * k;
}

function cleanupNet() {
  const ws = Net.ws;
  Net.ws = null;
  try { if (ws) ws.close(); } catch (e) { /* ignore */ }
  Net.wsConns.clear();
  try { if (Net.conn) Net.conn.close(); } catch (e) { /* ignore */ }
  for (const c of Net.conns.values()) { try { c.close(); } catch (e) { /* ignore */ } }
  Net.conn = null; Net.connected = false; Net.code = ''; Net.conns.clear();
  Net.ping = {}; Net.snapHz = 0; Net.snapN = 0; Net.left = {};
  resetPred();
}

// Связь с хостом оборвалась (не хост закрыл комнату): в меню и попытки вернуться в ту же игру — хост отдаст прежнее место
const REJOIN_TRIES = 6, REJOIN_MS = 5000;
function guestLost(msg) {
  const r = Net.rejoin;
  if (r) r.voice = !!Voice.stream;
  Net.rejoin = null;                // leaveToMenu не должен счесть это выходом по своей воле
  leaveToMenu(msg);
  if (r) rejoinStep(r, msg);
}
function rejoinStep(r, msg) {
  if (G.role === 'guest' || G.state !== 'menu' || r.cancel) return;      // вернулся или игрок сам занялся другим
  if (++r.tries > REJOIN_TRIES) { setStatus(`${msg}. Переподключиться не удалось — хост ещё в игре? Попробуйте войти вручную.`); return; }
  Net.rejoin = r;
  joinWs(r.tg);
  setStatus(`${msg}. Переподключение: попытка ${r.tries} из ${REJOIN_TRIES}…`);
  setTimeout(() => rejoinStep(r, msg), REJOIN_MS);
}

function leaveToMenu(msg) {
  if (Net.rejoin) Net.rejoin.cancel = true;       // вышел сам — не переподключаться
  Net.rejoin = null;
  const wasHost = G.role === 'host';
  cleanupNet();
  if (wasHost && appServer()) { try { appServer().stopServer(); } catch (e) { /* ignore */ } }   // телефон-хост: сервер больше не нужен
  Voice.reset();
  G.role = 'none'; G.state = 'menu';
  G.players = []; G.enemies = []; G.bullets = []; G.parts = []; G.decals = [];
  map = null;
  showMenu();
  setStatus(msg || '');
}
