'use strict';
// ---------- Состояние игры и создание сущностей ----------
// Две стороны: 'p' — отряд (люди и союзные боты, G.players), 'e' — противники (G.enemies).
// ИИ (ai: true) — общий для обеих сторон: одни и те же правила у противников и у союзных ботов.

const G = {
  time: 0,
  state: 'menu',         // menu | lobby | play | dead | win
  role: 'none',          // none | solo | host | guest
  mySlot: 0,             // моё место в отряде (0..3)
  seq: 0,                // номер запуска полигона (перезапуск у гостей)
  players: [],           // отряд: люди и боты (slot 0..3)
  enemies: [],
  bullets: [],
  parts: [],
  decals: [],
  cam: { x: 0, y: 0 },
  zoom: 1,              // масштаб камеры: по вертикали видно ~VIEW_M метров
  shake: 0,
  hurt: [],              // направления, откуда прилетело
  hitmark: null,
  toast: null,
  stateT: 0,
  fxOut: [],             // хост: события эффектов для гостей
};
let nextId = 1;
const me = () => G.players.find((q) => q.slot === G.mySlot);
const isAuth = () => G.role !== 'guest';             // хост или одиночная игра: мир считается здесь
const allPeople = () => [...G.players, ...G.enemies];
const teamOf = (side) => (side === 'e' ? G.enemies : G.players);
const foesOf = (o) => (o.side === 'e' ? G.players : G.enemies);
const aiList = () => [...G.enemies, ...G.players.filter((q) => q.ai)];
const SLOT_COLORS = ['#e0c040', '#40a0e0', '#e06040', '#60d080'];

// Оружие на руках: патроны в магазине, патрон в патроннике, запасные магазины (сколько в каждом)
function makeGun(type, mags) {
  const W = WEAPONS[type];
  return {
    t: type, mode: W.modes[0],
    mag: W.mag - 1, chamber: 1,          // зарядили: один патрон из магазина ушёл в патронник
    pouch: Array(mags - 1).fill(W.mag),
    cd: 0, reloadT: 0, reloadDur: 0, reloadEmpty: false,
    bloom: 0, lastShot: -9,
  };
}

function makePerson(side, x, y, a = 0) {
  return {
    id: nextId++, side, x, y, a, hp: HP, dead: false,
    crouch: false, ads: 0, sprint: false, sprintLock: 0,
    vx: 0, vy: 0, speed: 0, px: x, py: y,
    lean: 0, leanWant: 0, leanPx: 0, lx: x, ly: y,   // выглядывание: −1 влево … 1 вправо; lx, ly — глаза и ствол
    gun: makeGun('m4a1', side === 'p' ? WEAPONS.m4a1.mags : ENEMY.mags),
    flashT: 0, supp: 0, stepT: 0, hurtT: 9, lamp: false,
    keys: new Set(), act: null,     // ключи; текущее действие (отпирает, бьёт дверь)
    slot: -1, name: '', ai: false,
    down: false, bleed: 0, rev: 0, reviving: 0, revivedBy: null,   // ранен: истекает кровью; rev — прогресс подъёма
  };
}

// Добавить бойцу мозги ИИ (противнику или союзному боту — одни и те же правила)
function makeAI(o, a, patrol) {
  const { x, y } = o;
  Object.assign(o, {
    ai: true,
    hasLamp: true, lampT: 0, blind: 0,  // есть фонарь на оружии (работает при ENEMY.lamps)
    doorFire: null, doorFireCd: 0,  // обстрел закрытой двери на звук
    peek: null, peekCd: 0, flank: null,   // выглядывание из-за угла и обход
    kneel: false, kneelSet: false, stanceT: 0, stillT: 0,   // стрельба с колена
    role: null, fightT: 0, flankCd: 0, huntFlank: false, bodies: new Set(), barked: {}, supPause: 0,   // группа, манёвры, тела
    st: 0,                 // 0 спокоен, 1 насторожен, 2 бой
    notice: 0,             // 0..1 — насколько заметил цель
    target: null, lastX: x, lastY: y, lastSeen: -99, seeing: false,
    react: 0, aimT: 0, burst: 0, burstT: 0, pause: rand(0.2, 0.5),
    goal: null, cover: null, coverT: 0, searchT: 0, calmT: 0,
    home: { x, y, a }, look: a, lookT: rand(1, 3),
    patrol: patrol ? patrol.map(([px, py]) => ({ x: (px + 0.5) * TILE, y: (py + 0.5) * TILE })) : null, pi: 0,
    regroup: false, leader: -1, gSpot: null, gT: 0, stuckT: 0, unstuckT: 0, reviveSkip: null,
    fm: null, fmCd: 0, fmDecide: 0,   // огонь на ходу: отход с огнём / продвижение с подавлением
  });
  return o;
}

function makeEnemy(x, y, a, patrol) { return makeAI(makePerson('e', x, y, a), a, patrol); }

// Союзный бот на месте slot: держится рядом с ведущим человеком (leader — его место)
function makeBot(slot, x, y, a, leader) {
  const b = makeAI(makePerson('p', x, y, a), a, null);
  Object.assign(b, { slot, name: 'Бот ' + (slot + 1), leader });
  return b;
}

function makeHuman(slot, x, y, a, name) {
  return Object.assign(makePerson('p', x, y, a), { slot, name: name || 'Боец ' + (slot + 1) });
}

// Места отряда на старте: вокруг центра
const SPAWN_OFF = [[0, 0], [1.3, 0], [-1.3, 0], [0, 1.3]];

// Запуск полигона. squad — места отряда: [{ slot, human, name }]; bots — заполнить пустые места ботами.
function startRange(squad = null, bots = false) {
  buildRange();
  nextId = 1;
  G.seq = (G.seq || 0) + 1;
  G.players = []; G.enemies = []; G.bullets = []; G.parts = []; G.decals = []; G.hurt = [];
  G.hitmark = null; G.toast = null; G.muzzle = []; G.expo = null; G.squad = { t: 0, flankCd: 0 }; G.barks = []; G.fxOut = []; G.intel = { p: new Map(), e: new Map() };
  squad = squad || [{ slot: G.mySlot, human: true, name: G.myName }];
  G.lastSquad = squad; G.lastBots = bots;
  const s = map.start;
  const humans = squad.filter((q) => q.human).map((q) => q.slot);
  for (let slot = 0; slot < 4; slot++) {
    const q = squad.find((z) => z.slot === slot);
    const [ox, oy] = SPAWN_OFF[slot];
    const x = (s.x + ox) * TILE, y = (s.y + oy) * TILE, a = -Math.PI / 2;
    if (q && q.human) G.players.push(makeHuman(slot, x, y, a, q.name));
    else if (bots && humans.length) G.players.push(makeBot(slot, x, y, a, humans[slot % humans.length]));
  }
  for (const e of map.ents) {
    if (e.kind !== 'enemy') continue;
    G.enemies.push(makeEnemy(e.x * TILE, e.y * TILE, e.a || 0, e.patrol));
  }
  const p = me() || G.players[0];
  if (p) { G.cam.x = p.x; G.cam.y = p.y; }
  G.state = 'play'; G.stateT = 0;
  fieldCache.clear();
}

const alive = (list) => list.filter((o) => !o.dead);
