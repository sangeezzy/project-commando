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
// mags — сколько магазинов с собой (вместе с тем, что в оружии); у ружья — патронов россыпью (pouch: [число])
function makeGun(type, mags) {
  const W = WEAPONS[type];
  return {
    t: type, mode: W.modes[0],
    mag: W.mag - 1, chamber: 1,          // зарядили: один патрон из магазина ушёл в патронник
    pouch: W.cls === 'shotgun' ? [mags ?? W.shells] : Array((mags ?? W.mags) - 1).fill(W.mag),
    cd: 0, reloadT: 0, reloadDur: 0, reloadEmpty: false,
    bloom: 0, lastShot: -9,
  };
}

// Боекомплект: отряду — как в WEAPONS; противникам — поменьше (ENEMY.mags магазинов, ружьё — 16 патронов, пистолет — 3 магазина)
function ammoFor(type, side, ai) {
  const W = WEAPONS[type];
  if (side === 'p') return W.cls === 'shotgun' ? W.shells : W.mags;     // отряд (люди и боты) — полный боекомплект
  return W.cls === 'shotgun' ? 16 : W.cls === 'pistol' ? 3 : ENEMY.mags;
}

// Снаряжение: kit[0], kit[1] — полноразмерные (второго может не быть), kit[2] — пистолет (всегда). В руках — kit[cur] (= o.gun).
// off — какое полноразмерное сейчас в левой руке (выхвачен пистолет), −1 — нет
function giveKit(o, p1, p2) {
  o.kit = [makeGun(p1, ammoFor(p1, o.side, o.ai)), p2 && p2 !== p1 ? makeGun(p2, ammoFor(p2, o.side, o.ai)) : null,
    makeGun('m1911', ammoFor('m1911', o.side, o.ai))];
  o.cur = 0; o.gun = o.kit[0]; o.off = -1; o.sw = null; o.stowT = 0;
  return o;
}

// Случайный набор для ИИ: пистолет, нож и 1–2 разных полноразмерных (rnd — генератор карты: при перезапуске то же)
function randomKit(o, rnd = Math.random) {
  const ids = [...PRIMARY_IDS];
  const p1 = ids.splice(Math.floor(rnd() * ids.length), 1)[0];
  const p2 = rnd() < 0.5 ? ids[Math.floor(rnd() * ids.length)] : null;
  return giveKit(o, p1, p2);
}

function makePerson(side, x, y, a = 0) {
  return giveKit(newPerson(side, x, y, a), 'm4a1', null);      // по умолчанию: M4A1 + пистолет
}
function newPerson(side, x, y, a) {
  return {
    id: nextId++, side, x, y, a, hp: HP, dead: false,
    crouch: false, ads: 0, sprint: false, sprintLock: 0,
    vx: 0, vy: 0, speed: 0, px: x, py: y,
    lean: 0, leanWant: 0, leanPx: 0, lx: x, ly: y,   // выглядывание: −1 влево … 1 вправо; lx, ly — глаза и ствол
    gun: null, kit: null, cur: 0, off: -1, sw: null, stowT: 0, melee: null,   // оружие: см. giveKit; melee — удар ножом
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

// Запуск полигона (классический: тесты, автотест). squad — места отряда: [{ slot, human, name }]; bots — заполнить пустые места ботами.
function startRange(squad = null, bots = false) { startMap('range', 0, squad, bots); }

// Запуск карты id (hub, big, clear, range). seed — всё случайное на карте (старт отряда, противники, наборы ботов):
// тот же seed — та же расстановка (перезапуск с самой карты). Снаряжение людей — выбранное в хабе (G.kits по месту).
function startMap(id, seed = 0, squad = null, bots = false) {
  G.mapId = id; G.mapSeed = seed >>> 0;
  buildMap(id);
  const rnd = makeRng(G.mapSeed || 1);
  const mission = id === 'clear' ? missionSetup(rnd) : null;
  if (mission) map.start = mission.start;
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
    const sp = freeSpotNear((s.x + ox) * TILE, (s.y + oy) * TILE);
    const x = sp.x, y = sp.y, a = s.a ?? -Math.PI / 2;
    let o = null;
    if (q && q.human) {
      o = makeHuman(slot, x, y, a, q.name);
      const k = (G.kits || {})[slot];
      if (k) giveKit(o, k[0], k[1]);                 // выбранное на оружейном столе
    } else if (bots && humans.length) {
      o = makeBot(slot, x, y, a, humans[slot % humans.length]);
      if (id !== 'range') randomKit(o, rnd);
    }
    if (o) G.players.push(o);
  }
  if (mission) {
    for (const m of mission.enemies) G.enemies.push(randomKit(makeEnemy(m.x * TILE, m.y * TILE, m.a, m.patrol), rnd));
  } else for (const e of map.ents) {
    if (e.kind !== 'enemy') continue;
    G.enemies.push(makeEnemy(e.x * TILE, e.y * TILE, e.a || 0, e.patrol));
  }
  const p = me() || G.players[0];
  if (p) { G.cam.x = p.x; G.cam.y = p.y; }
  G.state = 'play'; G.stateT = 0;
  fieldCache.clear();
}

const alive = (list) => list.filter((o) => !o.dead);
