'use strict';
// ---------- Состояние игры, сущности, этапы и контрольные точки ----------

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let VW = 0, VH = 0;

const G = {
  role: 'none',            // 'solo' | 'host' | 'guest'
  myIdx: 0, myName: 'Боец',
  lv: 0, stage: 0, seq: 0, cp: 'start',
  state: 'menu',           // 'menu' | 'lobby' | 'play' | 'over'
  overT: 0,
  players: [], enemies: [], allies: [], bullets: [], nades: [], objs: [], speeders: [], decoys: [],
  parts: [], decals: [], rings: [], subs: [],
  nextId: 1, time: 0, titleT: 0, shake: 0, fadeT: 0,
  cam: { x: 0, y: 0 },
  fxOut: [],
  toast: null,
  m: null,                 // флаги миссии (см. freshFlags)
  cpData: null,            // снимок для перезапуска с контрольной точки
  progress: null,
  autopilot: false,        // тесты: локальным героем управляет ИИ бота
  ui: null,                // локальный интерфейс: диалог, мини-игра сканера
  hitmark: null,           // хитмаркер на прицеле
  loudT: 0,                // сколько ещё отряд «шумит» (боты помогают стрелять)
};
const isAuth = () => G.role === 'host' || G.role === 'solo';
const me = () => G.players.find((p) => p.idx === G.myIdx);
const pById = (idx) => G.players.find((p) => p.idx === idx);
const objById = (id) => G.objs.find((o) => o.id === id);
const objByName = (name) => G.objs.find((o) => o.name === name);
const markerPos = (name) => { const e = map && map.ents.find((q) => q.kind === 'marker' && q.name === name); return e ? { x: e.px, y: e.py } : null; };
const alivePlayers = () => G.players.filter((p) => !p.down);
const humans = () => G.players.filter((p) => !p.bot);

// ---------- Флаги миссии ----------
function freshFlags() {
  return {
    sq0: false, sq1: false, rvAll: false, rideT: 0,
    met: false, ordered: false, bribed: false, info: false, art: -1,   // art: у кого артефакт (-1 ни у кого, -2 отдан)
    stationOff: false, alarm: false, cenAlarm: false, centerAlert: false,
    scanned: false, hatchOpen: false, tunSaid: false, patrolMap: false,
    outCleared: false, cenOpen: false, cenCleared: false,
    boss: 0, bossT: BOSS_TIME, bossDelay: 0, endT: 0, result: '',
    clonesLeft: 6, camsAlarm: false,
  };
}
// компактная передача гостям: порядок ключей фиксирован
const M_KEYS = Object.keys(freshFlags());
const packFlags = (m) => M_KEYS.map((k) => (typeof m[k] === 'boolean' ? (m[k] ? 1 : 0) : typeof m[k] === 'number' ? r2(m[k]) : m[k]));
function unpackFlags(arr) {
  const m = freshFlags();
  M_KEYS.forEach((k, i) => { m[k] = typeof m[k] === 'boolean' ? !!arr[i] : arr[i]; });
  return m;
}

// ---------- Сущности ----------
function makePlayer(idx, ch, bot, name) {
  return {
    idx, ch, bot: !!bot, name: name || (bot ? 'БОТ' : 'Боец'), x: 0, y: 0, rx: 0, ry: 0, a: 0,
    hp: PLAYER_HP, down: false, revive: 0, hurtT: 9, regenT: 0,
    dash: 0, dashCd: 0, dvx: 0, dvy: 0,
    atkCd: 0, spCd: 0, melCd: 0, mel: 0,
    mv: MV.IDLE, stam: 1, exh: false, stamDelay: 0, stepT: 0, ringT: 0,
    lamp: true, flashT: 0, ride: -1, useId: 0, useP: 0, rad: false, net: false,
    vx: 0, vy: 0, px: 0, py: 0, bot2: {},
  };
}
const charOf = (p) => CHARS[p.ch];
const weaponOf = (p) => WEAPONS[CHARS[p.ch].weapon];
const isTech = (p) => CHARS[p.ch].special === 'decoy';

function makeEnemy(t, x, y, props = {}) {
  const T = ETYPES[t];
  const a = props.a !== undefined ? props.a : rand(-Math.PI, Math.PI);
  const sp = freeSpotNear(x, y, T.r);
  const e = {
    id: G.nextId++, t, x: sp.x, y: sp.y, rx: sp.x, ry: sp.y, a, look: a, lookT: rand(1, 3),
    hp: T.hp, maxHp: T.hp, dead: false, st: 0, react: 0, cd: rand(0.3, 0.8),
    burst: 0, burstT: 0, wind: 0, stun: 0, kvx: 0, kvy: 0, flash: 0, flashT: 0, alertT: 0, susT: 0,
    goal: null, searchT: 0, saw: false, lastX: 0, lastY: 0, zone: zoneAt(sp.x, sp.y),
    patrol: props.patrol ? props.patrol.map(([px, py]) => ({ x: px * TILE + 16, y: py * TILE + 16 })) : null, pi: 0,
    alarmT: 0, callT: 0, dodgeCd: 0, strafe: 1, strafeT: 0, leave: false, mark: 0, fear: 0, lostT: 0,
  };
  if (T.boss) Object.assign(e, { bst: 'gun', heat: 0, jamT: 0, over: 0, spin: 0, fireT: 0, armless: false });
  return e;
}

function makeAlly(t, x, y, props = {}) {
  const A = ATYPES[t];
  return {
    id: G.nextId++, t, x, y, rx: x, ry: y, a: props.a !== undefined ? props.a : 0,
    hp: A.hp, maxHp: A.hp, dead: false, mode: props.post ? 'post' : 'hold', captain: !!props.captain, tech: !!props.tech,
    home: { x, y }, cd: rand(0.2, 0.6), dodgeCd: 0, kvx: 0, kvy: 0, kick: 0, strafe: 1, strafeT: 0, flashT: 0, flash: 0, tgt: -1,
  };
}

function makeSpeeder(id, x, y, a) {
  return { id, x, y, rx: x, ry: y, a, vx: 0, vy: 0, seats: [-1, -1], noiseT: 0 };
}

// Интерактивные объекты карты: id = индекс сущности карты (одинаково у хоста и гостей)
function spawnObjects() {
  G.objs = []; G.speeders = [];
  for (const e of map.ents) {
    const base = { id: e.eid, k: e.kind, x: e.px, y: e.py };
    switch (e.kind) {
      case 'debris': G.objs.push({ ...base, tiles: e.tiles, prog: 0, done: false, rt: 0, eng: [], hits: [], name: e.id }); break;
      case 'gate': G.objs.push({ ...base, tiles: e.tiles, open: false, name: e.id, label: e.label }); break;
      case 'camera': G.objs.push({ ...base, a0: e.a, sweep: e.sweep, ang: e.a, on: !!e.fixed, fixed: !!e.fixed, label: e.label || '', seen: 0 }); break;
      case 'console': G.objs.push({ ...base, name: e.id, done: false }); break;
      case 'table': case 'container': case 'fire': case 'bush': case 'rv': case 'pad':
        G.objs.push({ ...base, done: false, r: e.r, lv: e.lv }); break;
      case 'item': G.objs.push({ ...base, item: e.item, done: false }); break;
      case 'npc': G.objs.push({ ...base, role: e.role, done: false }); break;
      case 'crate': G.objs.push({ ...base, name: e.id, done: false }); break;
      case 'speeder': G.speeders.push(makeSpeeder(e.eid, e.px, e.py, e.a || 0)); break;
    }
  }
}

// Состояние объекта для снимка (только меняющиеся поля)
function objState(o) {
  switch (o.k) {
    case 'debris': return [o.id, o.prog, o.done ? 1 : 0, r2(o.rt), o.eng];
    case 'gate': return [o.id, o.open ? 1 : 0];
    case 'camera': return [o.id, o.on ? 1 : 0, r2(o.ang), r2(o.seen)];
    default: return [o.id, o.done ? 1 : 0];
  }
}
function applyObjState(o, s) {
  switch (o.k) {
    case 'debris':
      o.prog = s[1]; o.rt = s[3]; o.eng = s[4] || []; o.rtAt = G.time;
      if (s[2] && !o.done) { o.done = true; setTiles(o.tiles, T.FLOOR); }
      break;
    case 'gate':
      if (!!s[1] !== o.open) { o.open = !!s[1]; setTiles(o.tiles, o.open ? T.FLOOR : T.GATE); }
      break;
    case 'camera': o.on = !!s[1]; o.ang = s[2]; o.seen = s[3]; break;
    default: o.done = !!s[1];
  }
}

function spawnEnemiesFromMap(filter = () => true) {
  G.enemies = [];
  for (const e of map.ents) {
    if (e.kind !== 'enemy' || !filter(e)) continue;
    G.enemies.push(makeEnemy(e.t, e.px, e.py, e));
  }
}

function spawnAlliesFromMap() {
  G.allies = [];
  for (const e of map.ents) if (e.kind === 'ally') G.allies.push(makeAlly(e.t, e.px, e.py, e));
}

// ---------- Прогресс (хранит хост/соло) ----------
function loadProgress() {
  const pr = LEVELS.map(() => ({ done: false, best: '' }));
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (Array.isArray(saved)) saved.forEach((v, i) => { if (pr[i] && v) { pr[i].done = !!v.done; pr[i].best = v.best || ''; } });
  } catch (e) { /* хранилище недоступно */ }
  return pr;
}
function saveProgress() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(G.progress)); } catch (e) { /* ignore */ }
}

// ---------- Этапы ----------
function resetWorldLists() {
  G.bullets = []; G.nades = []; G.decoys = []; G.decals = []; G.parts = []; G.rings = [];
  G.subs = []; G.ui = null;
}

// хост/соло: (пере)запустить этап. cp — контрольная точка внутри этапа.
function startStage(lv, stage, cp = 'start') {
  G.lv = lv; G.stage = stage; G.cp = cp;
  G.seq++;
  fieldCache.clear();
  buildStageMap(lv, stage);
  spawnObjects();
  resetWorldLists();
  G.state = 'play'; G.overT = 0;
  G.titleT = 3.5;
  if (!G.m && !map.hub) G.m = freshFlags();

  if (map.hub) {
    G.enemies = []; G.allies = [];
    const spawns = map.ents.filter((e) => e.kind === 'spawn');
    for (const p of G.players) {
      resetPlayer(p);
      const s = spawns[p.idx % spawns.length];
      p.x = p.rx = s.px; p.y = p.ry = s.py;
    }
  } else if (stage === 1) setupCaves(cp);
  else if (stage === 2) setupTown(cp);

  const p = me();
  if (p) { G.cam.x = p.x; G.cam.y = p.y; }
}

function resetPlayer(p) {
  p.tp = (p.tp | 0) + 1;      // гость примет новую позицию от хоста
  Object.assign(p, {
    hp: PLAYER_HP, down: false, revive: 0, dash: 0, dashCd: 0, atkCd: 0, spCd: 0, melCd: 0, mel: 0,
    mv: MV.IDLE, stam: 1, exh: false, lamp: true, flashT: 0, ride: -1, useId: 0, useP: 0, hurtT: 9,
    vx: 0, vy: 0, bot2: {},
  });
}

function setupCaves(cp) {
  spawnEnemiesFromMap();
  G.allies = [];
  if (cp === 'rv') {
    // контрольная точка у костра: пещеры пройдены, все в сборе
    for (const o of G.objs) if (o.k === 'debris') { o.done = true; setTiles(o.tiles, T.FLOOR); }
    for (const e of G.enemies) e.dead = true;
    G.enemies = [];
    const rv = G.objs.find((o) => o.k === 'rv');
    G.players.forEach((p, i) => {
      resetPlayer(p);
      const s = freeSpotNear(rv.x + Math.cos(i * 1.6) * 60, rv.y + 40 + Math.sin(i * 1.6) * 30);
      p.x = p.rx = s.x; p.y = p.ry = s.y;
    });
  } else {
    for (const sq of [0, 1]) {
      const spawns = map.ents.filter((e) => e.kind === 'spawn' && e.squad === sq);
      const members = G.players.filter((p) => CHARS[p.ch].squad === sq).sort((a, b) => a.ch - b.ch);
      members.forEach((p, i) => {
        resetPlayer(p);
        const s = spawns[i % spawns.length];
        p.x = p.rx = s.px; p.y = p.ry = s.py; p.a = -Math.PI / 2;
      });
    }
  }
  saveCheckpoint();
}

function setupTown(cp) {
  const m = G.m;
  // камеры: две постоянные + три случайные из возможных мест
  const extra = shuffle(G.objs.filter((o) => o.k === 'camera' && !o.fixed)).slice(0, 3);
  for (const c of extra) c.on = true;
  G.objs = G.objs.filter((o) => o.k !== 'camera' || o.on);
  if (m.stationOff) for (const c of G.objs) if (c.k === 'camera') c.on = false;

  const gate = (n) => objByName(n);
  if (m.scanned) openGate(gate('tunnelIn'), true);
  if (m.hatchOpen) openGate(gate('hatch'), true);
  for (const o of G.objs) {
    if (o.k === 'console' && m.stationOff) o.done = true;
    if (o.k === 'table' && m.patrolMap) o.done = true;
    if (o.k === 'item' && m.art !== -1) o.done = true;
    if (o.k === 'crate' && m.scanned) o.done = true;
    if (o.k === 'npc' && ((o.role === 'glasses' && m.info) || (o.role === 'merc' && m.bribed))) o.done = true;
  }

  spawnAlliesFromMap();
  const front = G.allies.filter((a) => !a.tech);
  // клоны, погибшие до контрольной точки, не возвращаются
  front.slice(m.clonesLeft).forEach((a) => { a.dead = true; });
  G.allies = G.allies.filter((a) => !a.dead);

  if (cp === 'start') {
    spawnEnemiesFromMap();
    // все на спидерах: отряд 1 на первом, отряд 2 на втором, человек — за рулём
    const sps = G.speeders.slice(0, 2);
    for (const p of G.players) resetPlayer(p);
    for (const sq of [0, 1]) {
      const members = G.players.filter((p) => CHARS[p.ch].squad === sq).sort((a, b) => (a.bot - b.bot) || (a.ch - b.ch));
      members.forEach((p, i) => seatPlayer(p, sps[sq], i));
    }
  } else {
    // центр или босс: окраины уже зачищены, ворота центра открыты
    m.met = true; m.outCleared = true; m.cenOpen = true;
    openGate(gate('innerGate'), true);
    spawnEnemiesFromMap((e) => cp === 'center' && zoneOfEnt(e) === 'cen');
    if (m.centerAlert) alertCenter();
    const sp = map.ents.find((e) => e.kind === 'cpspawn' && e.cp === cp);
    G.players.forEach((p, i) => {
      resetPlayer(p);
      const s = freeSpotNear(sp.px + (i % 2) * 30 - 15, sp.py + Math.floor(i / 2) * 30 - 15);
      p.x = p.rx = s.x; p.y = p.ry = s.y; p.a = 0;
    });
    // спидеры оставили у лагеря клонов
    G.speeders.forEach((s, i) => { s.x = s.rx = 30 * TILE + i * 40; s.y = s.ry = 62 * TILE; });
    if (m.ordered) {
      front.forEach((a, i) => {
        if (a.dead) return;
        const s = freeSpotNear(sp.px - 60 - (i % 3) * 28, sp.py + (Math.floor(i / 3) - 0.5) * 36);
        a.x = a.rx = s.x; a.y = a.ry = s.y; a.mode = 'follow';
      });
    }
    if (m.bribed) spawnMercs();
    if (cp === 'boss') { m.cenCleared = true; spawnBoss(); }
  }
  saveCheckpoint();
}

const zoneOfEnt = (e) => zoneAt(e.px, e.py);

function openGate(o, silent) {
  if (!o || o.open) return;
  o.open = true;
  setTiles(o.tiles, T.FLOOR);
  if (!silent) emit(['gate', o.x, o.y]);
}

function seatPlayer(p, s, seat) {
  if (!s) return;
  if (s.seats[seat] !== -1) seat = s.seats.indexOf(-1);
  if (seat < 0) return;
  s.seats[seat] = p.idx;
  p.ride = s.id;
  p.x = p.rx = s.x; p.y = p.ry = s.y;
}

function saveCheckpoint() {
  G.cpData = { lv: G.lv, stage: G.stage, cp: G.cp, m: JSON.parse(JSON.stringify(G.m)) };
}

function restartFromCheckpoint() {
  if (!isAuth()) { send({ t: 'r' }); return; }
  if (!G.cpData || map.hub) return;
  G.m = JSON.parse(JSON.stringify(G.cpData.m));
  startStage(G.cpData.lv, G.cpData.stage, G.cpData.cp);
}

// Новая контрольная точка посреди этапа (без перестройки карты)
function checkpointHere(cp) {
  G.cp = cp;
  saveCheckpoint();
  emit(['cp']);
}

function startMission(lv) {
  G.m = freshFlags();
  startStage(lv, 1, 'start');
  G.brief = { lv, t: 0 };
  emit(['brief', lv]);
}

function returnToHub(success, result) {
  if (success && !LEVELS[G.lv].hub) {
    const pr = G.progress[G.lv];
    pr.done = true; pr.best = result || pr.best;
    saveProgress();
  }
  const lv = G.lv;
  G.m = null;
  startStage(0, 0);
  if (success) G.toast = { text: `${LEVELS[lv].name} — ВЫПОЛНЕНО`, t: 5 };
}

// ---------- Наёмники и босс ----------
function spawnMercs() {
  const spots = map.ents.filter((e) => e.kind === 'mercspot');
  const s = pickRandom(spots);
  for (let i = 0; i < 3; i++) {
    const p = freeSpotNear(s.px + (i - 1) * 28, s.py);
    const a = makeAlly('merc', p.x, p.y);
    a.mode = 'fight';
    G.allies.push(a);
  }
  return s;
}

function spawnBoss() {
  const c = G.objs.find((o) => o.k === 'container');
  if (c) c.done = true;
  const e = makeEnemy('X', c.x, c.y + 36, { a: Math.PI / 2 });
  e.st = 2; e.alertT = 1;
  G.enemies.push(e);
  G.m.boss = 1; G.m.bossT = BOSS_TIME;
  return e;
}

function alertCenter() {
  const gin = markerPos('innerGateIn');
  for (const e of G.enemies) {
    if (e.dead || e.zone !== 'cen') continue;
    e.st = 2; e.alertT = 1;
    if (gin && !ETYPES[e.t].comm) { e.goal = fieldTo(gin.x, gin.y); e.searchT = 0; }
  }
}
