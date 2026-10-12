'use strict';
/* =====================================================================
   NEON SABERS — кооперативный top-down экшен в духе Hotline Miami
   Сеть: PeerJS (WebRTC). Хост — авторитетный (враги, пули, попадания),
   каждый игрок сам двигает своего героя и шлёт позицию хосту.
   ===================================================================== */

// ---------- Константы ----------
const TILE = 32;
const PR = 11;                 // радиус игрока
const ER = 11;                 // радиус врага
const SWING_T = 0.18;          // длительность удара мечом
const PEER_PREFIX = 'neon-sabers-v1-';
const SNAP_MS = 50;            // хост -> гость, 20 Гц
const INPUT_MS = 33;           // гость -> хост, 30 Гц
const PLAYER_COLORS = ['#33ccff', '#9dff3a'];
const ENEMY_BOLT = '#ff3344';

// Режимы движения и шум. Радиус шума в px считается «по пути» — звук огибает стены.
const MV = { IDLE: 0, SLOW: 1, WALK: 2, SPRINT: 3 };
const NOISE = { walk: 150, sprint: 340, blaster: 420, push: 170, ignite: 120, death: 110, enemyShot: 260, boom: 650 };
const SPRINT_MUL = 1.6, SLOW_MUL = 0.45;
const STAMINA_DRAIN = 2.5;     // секунд спринта на полной выносливости
const STAMINA_REGEN = 3;       // секунд на полное восстановление
const ENEMY_SIGHT = 450;       // дальность зрения врагов (светлые зоны или герой «светится»)
const DARK_SIGHT = 130;        // герой в темноте: спокойные/насторожённые враги замечают только вблизи
const DARK_SIGHT_ALERT = 180;  // ...встревоженные вглядываются чуть дальше
const MUZZLE_FLASH_T = 0.6;    // сколько секунд после выстрела бластера герой виден в темноте
const RETURN_DELAY = 8;        // через сколько секунд после зачистки отряд возвращается на базу
const PAD_HOLD = 1.2;          // сколько стоять на площадке, чтобы вылететь на миссию
const UNLOCK_ALL = false;      // true — все миссии открыты сразу
const SAVE_KEY = 'neon-sabers-progress-v1';   // ключ сохранения прогресса в localStorage
const FOG_R = 250;             // радиус видимости вокруг игрока
const FOG_SHARED = true;       // видно и то, что вокруг напарника
const SABER_REVEAL = 330;      // свет меча раздвигает туман в этом радиусе от клинка
const SABER_NOTICE = 180;      // ...но спокойные враги замечают свечение с любой стороны

const CLASSES = {
  jedi: {
    name: 'ДЖЕДАЙ', speed: 185,
    desc: 'ЛКМ — удар световым мечом: рубит врагов и отражает выстрелы туда, куда смотрит курсор. ' +
          'ПКМ — толчок Силы: отбрасывает врагов (об стену — насмерть). Меч бесшумный — идеален для скрытности.',
  },
  smuggler: {
    name: 'КОНТРАБАНДИСТ', speed: 180,
    desc: 'ЛКМ — бластер (зажать; следи за перегревом, выстрелы слышат все вокруг). ' +
          'ПКМ — термальный детонатор: бросок в точку курсора.',
  },
};

const ETYPES = {
  // fire — пауза между очередями, burstGap — между выстрелами в очереди, spread — разброс (рад), bolt — скорость заряда
  T: { name: 'штурмовик', hp: 1, speed: 70, chase: 125, color: '#e6ecff', fire: [0.8, 1.2], burst: 1, burstGap: 0.12, spread: 0.03, bolt: 520, score: 100 },
  H: { name: 'тяжёлый',   hp: 3, speed: 40, chase: 85,  color: '#ff8a3d', fire: [0.6, 0.85], burst: 4, burstGap: 0.08, spread: 0.045, bolt: 480, score: 250 },
  M: { name: 'чистильщик', hp: 1, speed: 80, chase: 240, color: '#ff2a5a', melee: true, score: 150 },
};

// LEVELS[0] — база (хаб), дальше миссии.
// # стена, P старт, E выход, T штурмовик, H тяжёлый штурмовик, M чистильщик (ближний бой), 1-9 площадка миссии
// dark — тёмные комнаты [x0, y0, x1, y1] (клетки, включительно). Там туман с радиусом видимости,
// в остальных (светлых) местах видно всё, до чего есть прямая видимость.
const LEVELS = [
  // База: безопасный зал, цифры 1..9 — площадки вылета на миссию LEVELS[n]
  { name: 'БАЗА ПОВСТАНЦЕВ', color: '#9d8cff', hub: true, map: [
    '###############################',
    '#.............................#',
    '#.............................#',
    '#....1.........2.........3....#',
    '#.............................#',
    '#.............................#',
    '#...##...................##...#',
    '#...##...................##...#',
    '#.............................#',
    '#.............P.P.............#',
    '#.............................#',
    '#...##...................##...#',
    '#...##...................##...#',
    '#.............................#',
    '###############################',
  ]},
  { name: 'АНГАР 7', color: '#ff2bd6', dark: [[1, 7, 10, 14], [6, 11, 17, 13], [19, 9, 22, 10]], map: [
    '########################################',
    '#P.....#..............#.......T........#',
    '#.P....#..............#................#',
    '#......#.......T......#.....####.......#',
    '#.....................#.....#..#...T...#',
    '#......#..............#.....####.......#',
    '###..#####..######..###................#',
    '#..........#......................######',
    '#..T.......#......######...............#',
    '#..........#......#....#.......H.......#',
    '#....###########..#....#...............#',
    '#....#...........T#....#####..#######..#',
    '#....#............#....................#',
    '#....#....T.......#..................E.#',
    '#...........................T..........#',
    '########################################',
  ]},
  { name: 'ТЮРЕМНЫЙ БЛОК АА-23', color: '#33ffcc', dark: [[10, 1, 18, 3], [1, 8, 10, 11], [25, 8, 35, 11]], map: [
    '##############################################',
    '#P.P.....#.........#.........#...............#',
    '#........#....M....#....T....#.......H.......#',
    '#........#.........#.........#...............#',
    '#........###..######..########....#######....#',
    '#............................................#',
    '#..T.........................................#',
    '#####..#########..#########..########..#######',
    '#..........#............#..........#.........#',
    '#....M.....#.....T......#....M.....#....T....#',
    '#..........#............#..........#.........#',
    '#..........######..######..........#.........#',
    '#...T................................M.....E.#',
    '##############################################',
  ]},
  { name: 'МОСТИК РАЗРУШИТЕЛЯ', color: '#ffb000', dark: [[1, 7, 13, 10], [21, 9, 31, 11], [42, 6, 48, 10]], map: [
    '##################################################',
    '#P.P..........#...................#..............#',
    '#.............#.......T...........#......T.......#',
    '#.............#...................#..............#',
    '#.............######.......########......M.......#',
    '#........................................#########',
    '#######..#####............H..............#.......#',
    '#.............#..........................#...T...#',
    '#....M........#.....#####....#####.......#.......#',
    '#.............#.....#...........#..........M.....#',
    '#.........T...#.....#....T......#........#.......#',
    '#######..######.....#...........#........####..###',
    '#...................#####....#####...............#',
    '#....H.......................................H...#',
    '#............M..........T..................T...E.#',
    '##################################################',
  ]},
];

// ---------- Утилиты ----------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const r1 = (v) => Math.round(v);
const r2 = (v) => Math.round(v * 100) / 100;
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
const turnTo = (a, t, max) => a + clamp(angDiff(t, a), -max, max);
function rgba(hex, a) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const playerColor = (idx) => PLAYER_COLORS[idx] || '#fff';

// ---------- Состояние ----------
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let VW = 0, VH = 0;

const G = {
  role: 'none',            // 'solo' | 'host' | 'guest'
  myIdx: 0, cls: 'jedi',
  lv: 0, seq: 0,
  state: 'menu',           // 'play' | 'over' | 'win'
  overT: 0,
  score: 0, levelScore: 0, combo: 0, comboT: 0,
  exitOpen: false,
  players: [], enemies: [], bullets: [], nades: [],
  parts: [], decals: [], rings: [],
  nextId: 1, time: 0, titleT: 0, shake: 0,
  cam: { x: 0, y: 0 },
  fxOut: [],
  toast: null,
};
let map = null;
const isAuth = () => G.role === 'host' || G.role === 'solo';
const me = () => G.players.find((p) => p.idx === G.myIdx);

// ---------- Карта ----------
function buildMap(lv) {
  const L = LEVELS[lv];
  const h = L.map.length;
  const w = Math.max(...L.map.map((r) => r.length));
  const grid = new Uint8Array(w * h);
  const spawns = [], ents = [], pads = [];
  let exit = null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = L.map[y][x] || '#';
      if (ch === '#') { grid[y * w + x] = 1; continue; }
      const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2;
      if (ch === 'P') spawns.push({ x: cx, y: cy });
      else if (ch === 'E') exit = { tx: x, ty: y, x: cx, y: cy };
      else if (ETYPES[ch]) ents.push({ t: ch, x: cx, y: cy });
      else if (ch >= '1' && ch <= '9' && LEVELS[+ch]) pads.push({ lv: +ch, tx: x, ty: y, x: cx, y: cy });
    }
  }
  const dark = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of L.dark || []) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x < w && y < h) dark[y * w + x] = 1;
  }
  map = { w, h, grid, dark, spawns, ents, pads, exit, hub: !!L.hub, color: L.color, name: L.name };
  buildLightMasks();
  map.canvas = renderMapCanvas();
}

function solidTile(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  return map.grid[ty * map.w + tx] === 1;
}
const solidAt = (x, y) => solidTile(Math.floor(x / TILE), Math.floor(y / TILE));
const tileIndex = (x, y) => Math.floor(y / TILE) * map.w + Math.floor(x / TILE);
function darkAt(x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
  return map.dark[ty * map.w + tx] === 1;
}

// Маски светлых и тёмных зон (мировые координаты). Стена относится к зоне соседнего пола,
// чтобы её неоновая кромка открывалась вместе с комнатой.
function buildLightMasks() {
  const { w, h } = map;
  const mk = () => { const c = document.createElement('canvas'); c.width = w * TILE; c.height = h * TILE; return c; };
  const lit = mk(), dark = mk();
  const lg = lit.getContext('2d'), dg = dark.getContext('2d');
  lg.fillStyle = dg.fillStyle = '#fff';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let toLit = false, toDark = false;
      if (!solidTile(x, y)) { if (map.dark[y * w + x]) toDark = true; else toLit = true; }
      else {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (solidTile(nx, ny)) continue;
          if (map.dark[ny * w + nx]) toDark = true; else toLit = true;
        }
      }
      if (toLit) lg.fillRect(x * TILE, y * TILE, TILE, TILE);
      if (toDark) dg.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }
  map.litMask = lit; map.darkMask = dark;
}

function renderMapCanvas() {
  const c = document.createElement('canvas');
  c.width = map.w * TILE; c.height = map.h * TILE;
  const g = c.getContext('2d');
  g.fillStyle = '#05030a';
  g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (solidTile(x, y)) {
        g.fillStyle = '#120a20';
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
      } else {
        const isDark = map.dark[y * map.w + x] === 1;
        g.fillStyle = isDark ? ((x + y) & 1 ? '#07050d' : '#06040b') : ((x + y) & 1 ? '#0e0a1b' : '#0c0817');
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
        g.strokeStyle = rgba(map.color, isDark ? 0.025 : 0.07);
        g.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
      }
    }
  }
  // неоновые кромки стен — только там, где стена граничит с полом
  g.beginPath();
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (!solidTile(x, y)) continue;
      const X = x * TILE, Y = y * TILE;
      const open = (nx, ny) => nx >= 0 && ny >= 0 && nx < map.w && ny < map.h && !solidTile(nx, ny);
      if (open(x, y - 1)) { g.moveTo(X, Y); g.lineTo(X + TILE, Y); }
      if (open(x, y + 1)) { g.moveTo(X, Y + TILE); g.lineTo(X + TILE, Y + TILE); }
      if (open(x - 1, y)) { g.moveTo(X, Y); g.lineTo(X, Y + TILE); }
      if (open(x + 1, y)) { g.moveTo(X + TILE, Y); g.lineTo(X + TILE, Y + TILE); }
    }
  }
  g.lineCap = 'round';
  g.strokeStyle = map.color; g.shadowColor = map.color;
  g.globalAlpha = 0.3; g.lineWidth = 7; g.shadowBlur = 22; g.stroke();
  g.globalAlpha = 1; g.lineWidth = 2.5; g.shadowBlur = 10; g.stroke();
  g.shadowBlur = 0; g.strokeStyle = '#fff'; g.globalAlpha = 0.55; g.lineWidth = 0.8; g.stroke();
  g.globalAlpha = 1;
  return c;
}

// Круг против тайловой сетки. Возвращает true, если упёрлись в стену.
function moveCircle(o, dx, dy, r) {
  o.x += dx; o.y += dy;
  let hit = false;
  for (let it = 0; it < 2; it++) {
    const x0 = Math.floor((o.x - r) / TILE), x1 = Math.floor((o.x + r) / TILE);
    const y0 = Math.floor((o.y - r) / TILE), y1 = Math.floor((o.y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!solidTile(tx, ty)) continue;
        const cx = clamp(o.x, tx * TILE, tx * TILE + TILE);
        const cy = clamp(o.y, ty * TILE, ty * TILE + TILE);
        let ddx = o.x - cx, ddy = o.y - cy;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 >= r * r) continue;
        hit = true;
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2), push = r - d;
          o.x += (ddx / d) * push; o.y += (ddy / d) * push;
        } else {
          // центр внутри тайла — выталкиваем по кратчайшей оси
          const l = o.x - tx * TILE, rr = tx * TILE + TILE - o.x;
          const t = o.y - ty * TILE, b = ty * TILE + TILE - o.y;
          const m = Math.min(l, rr, t, b);
          if (m === l) o.x -= l + r; else if (m === rr) o.x += rr + r;
          else if (m === t) o.y -= t + r; else o.y += b + r;
        }
      }
    }
  }
  return hit;
}

function los(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.ceil(Math.hypot(dx, dy) / 8);
  for (let i = 1; i < steps; i++) {
    if (solidAt(x0 + (dx * i) / steps, y0 + (dy * i) / steps)) return false;
  }
  return true;
}

// BFS по тайлам от точки: расстояние «по пути». По нему распространяется звук и по нему же
// враги идут к месту, где что-то услышали или в последний раз видели игрока.
function bfsFrom(x, y, maxD = 1e9) {
  const { w, h } = map;
  const f = new Int32Array(w * h).fill(1e9);
  const sx = Math.floor(x / TILE), sy = Math.floor(y / TILE);
  if (solidTile(sx, sy)) return { f, x, y };
  const q = new Int32Array(w * h);
  let qh = 0, qt = 0;
  f[sy * w + sx] = 0; q[qt++] = sy * w + sx;
  while (qh < qt) {
    const i = q[qh++];
    if (f[i] >= maxD) continue;
    const x0 = i % w, y0 = (i / w) | 0, nd = f[i] + 1;
    const nb = [[x0 + 1, y0], [x0 - 1, y0], [x0, y0 + 1], [x0, y0 - 1]];
    for (const [nx, ny] of nb) {
      if (solidTile(nx, ny)) continue;
      const j = ny * w + nx;
      if (f[j] > nd) { f[j] = nd; q[qt++] = j; }
    }
  }
  return { f, x, y };
}

// ---------- Сущности ----------
function makePlayer(idx, cls) {
  return {
    idx, cls, x: 0, y: 0, rx: 0, ry: 0, a: 0,
    dead: false, revive: 0,
    dash: 0, dashCd: 0, dvx: 0, dvy: 0,
    atkCd: 0, swing: 0, swingDir: 1, spCd: 0,
    heat: 0, overheat: 0, net: false,
    mv: MV.IDLE, stam: 1, exh: false, stamDelay: 0, stepT: 0, ringT: 0,
    saberOn: true, saberLen: 1,   // меч зажжён; saberLen 0..1 — насколько выдвинут клинок
  };
}

function placePlayer(p) {
  const s = map.spawns[p.idx % map.spawns.length] || map.spawns[0];
  p.x = p.rx = s.x; p.y = p.ry = s.y;
  p.dead = false; p.revive = 0; p.dash = 0; p.swing = 0; p.heat = 0; p.overheat = 0;
  p.a = 0; p.mv = MV.IDLE; p.stam = 1; p.exh = false; p.saberOn = true; p.saberLen = 1;
  p.vx = 0; p.vy = 0; p.px = p.x; p.py = p.y;
}

function spawnEnemies() {
  G.enemies = map.ents.map((s) => {
    const T = ETYPES[s.t];
    const a = rand(-Math.PI, Math.PI);
    return {
      id: G.nextId++, t: s.t, x: s.x, y: s.y, rx: s.x, ry: s.y, a, look: a, lookT: rand(1, 3),
      hp: T.hp, dead: false, st: 0, react: 0, cd: rand(0.3, 0.8),
      burst: 0, burstT: 0, wind: 0, stun: 0, kvx: 0, kvy: 0, flash: 0, alertT: 0, susT: 0, pushBy: -1,
      goal: null, searchT: 0, saw: false, lastX: 0, lastY: 0,
    };
  });
}

// ---------- Прогресс миссий (хранит хост/соло) ----------
function loadProgress() {
  const pr = LEVELS.map(() => ({ done: false, best: 0 }));
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (Array.isArray(saved)) saved.forEach((v, i) => { if (pr[i] && v) { pr[i].done = !!v.done; pr[i].best = v.best | 0; } });
  } catch (e) { /* хранилище недоступно — играем без сохранения */ }
  return pr;
}
function saveProgress() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(G.progress)); } catch (e) { /* ignore */ }
}
G.progress = loadProgress();
const missionUnlocked = (lv) => UNLOCK_ALL || lv <= 1 || (G.progress[lv - 1] && G.progress[lv - 1].done);

// хост/соло: вернуться на базу. success — миссия выполнена.
function returnToHub(success) {
  const lv = G.lv, score = G.score;
  if (success && !LEVELS[lv].hub) {
    const pr = G.progress[lv];
    const first = !pr.done;
    pr.done = true; pr.best = Math.max(pr.best, score);
    saveProgress();
    startLevel(0);
    const all = G.progress.every((q, i) => LEVELS[i].hub || q.done);
    G.toast = { text: all && first ? 'ВСЕ МИССИИ ВЫПОЛНЕНЫ!' : `МИССИЯ ВЫПОЛНЕНА · СЧЁТ ${score}`, t: 4 };
  } else startLevel(0);
}

// хост/соло: (пере)запуск уровня
function startLevel(lv) {
  G.lv = lv;
  G.seq++;
  buildMap(lv);
  spawnEnemies();
  G.bullets = []; G.nades = []; G.decals = []; G.parts = []; G.rings = [];
  G.exitOpen = false;
  G.state = 'play';
  G.score = 0;
  G.returnT = 0; G.pad = null;
  G.combo = 0; G.comboT = 0;
  for (const p of G.players) placePlayer(p);
  G.titleT = 3;
  const p = me();
  if (p) { G.cam.x = p.x; G.cam.y = p.y; }
}

function requestRestart() {
  if (!isAuth()) { send({ t: 'r' }); return; }
  if (map && map.hub) return;            // на базе перезапускать нечего
  startLevel(G.lv);
}

// H на экране гибели — вернуться на базу
function requestHub() {
  if (G.state !== 'over') return;
  if (!isAuth()) { send({ t: 'hub' }); return; }
  returnToHub(false);
}

// ---------- Ввод ----------
const keys = {};
const mouse = { x: 0, y: 0, l: false, r: false, rPressed: false };
let spacePressed = false;
let saberKeyPressed = false;

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (e.code === 'Space') { spacePressed = true; e.preventDefault(); }
  if (e.key === 'Alt') e.preventDefault();
  if (e.code === 'KeyR' && G.role !== 'none' && !e.repeat) requestRestart();
  if (e.code === 'KeyH' && G.role !== 'none' && !e.repeat) requestHub();
  if (e.code === 'KeyF' && !e.repeat) saberKeyPressed = true;
  if (e.code === 'Escape' && G.role !== 'none') leaveToMenu('');
});
addEventListener('keyup', (e) => { keys[e.code] = false; if (e.key === 'Alt') e.preventDefault(); });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.l = mouse.r = false; });
canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', (e) => {
  initAudio();
  if (e.button === 0) mouse.l = true;
  if (e.button === 2) { mouse.r = true; mouse.rPressed = true; }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) mouse.l = false;
  if (e.button === 2) mouse.r = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const screenToWorld = (sx, sy) => ({ x: sx - VW / 2 + G.cam.x, y: sy - VH / 2 + G.cam.y });

// ---------- Действия игроков ----------
function tickPlayerTimers(p, dt) {
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.atkCd = Math.max(0, p.atkCd - dt);
  p.spCd = Math.max(0, p.spCd - dt);
  p.flashT = Math.max(0, (p.flashT || 0) - dt);
  p.swing = Math.max(0, p.swing - dt);
  p.saberLen = clamp(p.saberLen + (p.saberOn ? dt : -dt) * 5, 0, 1);   // клинок выдвигается за 0.2 с
  if (!p.net) p.dash = Math.max(0, p.dash - dt);
  if (p.overheat > 0) { p.overheat -= dt; if (p.overheat <= 0) p.heat = 0; }
  else p.heat = Math.max(0, p.heat - dt * 0.55);
}

function controlLocal(p, dt) {
  const pressedDash = spacePressed, pressedR = mouse.rPressed, pressedF = saberKeyPressed;
  spacePressed = false; mouse.rPressed = false; saberKeyPressed = false;
  if (p.dead || G.state !== 'play') { p.mv = MV.IDLE; return; }

  let mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  let my = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  const ml = Math.hypot(mx, my);
  if (ml) { mx /= ml; my /= ml; }
  const wm = screenToWorld(mouse.x, mouse.y);
  p.a = Math.atan2(wm.y - p.y, wm.x - p.x);

  // режим движения: Alt — крадёмся (бесшумно), Shift — спринт (громко, тратит выносливость)
  const wantSlow = keys.AltLeft || keys.AltRight;
  const wantSprint = keys.ShiftLeft || keys.ShiftRight;
  let mode = MV.IDLE;
  if (ml) mode = wantSlow ? MV.SLOW : wantSprint && !p.exh && p.stam > 0 ? MV.SPRINT : MV.WALK;
  if (mode === MV.SPRINT) {
    p.stam -= dt / STAMINA_DRAIN; p.stamDelay = 0.6;
    if (p.stam <= 0) { p.stam = 0; p.exh = true; }
  } else {
    p.stamDelay -= dt;
    if (p.stamDelay <= 0) p.stam = Math.min(1, p.stam + dt / STAMINA_REGEN);
    if (p.exh && p.stam >= 0.35) p.exh = false;
  }

  if (pressedDash && p.dashCd <= 0) {
    const da = ml ? Math.atan2(my, mx) : p.a;
    p.dvx = Math.cos(da) * 650; p.dvy = Math.sin(da) * 650;
    p.dash = 0.15; p.dashCd = 0.8;
    SFX.dash();
  }
  if (p.dash > 0) {
    moveCircle(p, p.dvx * dt, p.dvy * dt, PR);
    addPart(p.x + rand(-4, 4), p.y + rand(-4, 4), 0, 0, 0.25, playerColor(p.idx), 3);
  } else {
    const mul = mode === MV.SPRINT ? SPRINT_MUL : mode === MV.SLOW ? SLOW_MUL : 1;
    const sp = CLASSES[p.cls].speed * mul * (p.swing > 0 ? 0.85 : 1);
    moveCircle(p, mx * sp * dt, my * sp * dt, PR);
  }
  p.mv = p.dash > 0 ? MV.SPRINT : mode;   // рывок шумит как спринт
  p.rx = p.x; p.ry = p.y;

  if (pressedF && p.cls === 'jedi') toggleSaber(p);
  if (mouse.l) tryAttack(p);
  if (pressedR) trySpecial(p, wm);
}

// Зажечь/погасить меч. Погашенный не светится и не выдаёт, но им нельзя бить и отражать.
function toggleSaber(p) {
  p.saberOn = !p.saberOn;
  if (p.saberOn) p.atkCd = Math.max(p.atkCd, 0.2);   // пока клинок выдвигается — не бьём
  const on = p.saberOn ? 1 : 0;
  if (isAuth()) setSaber(p, on);
  else { playFx(['sab', p.idx, on]); send({ t: 'a', k: 'sab', s: G.seq, a: r2(p.a), on }); }
}

// хост: применить состояние меча, звук и шум зажигания
function setSaber(p, on) {
  p.saberOn = !!on;
  emit(['sab', p.idx, on]);
  if (on) makeNoise(p.x, p.y, NOISE.ignite, false);
}

const saberReady = (p) => p.cls === 'jedi' && p.saberOn && p.saberLen > 0.7;

function startSwing(p) {
  p.swing = SWING_T;
  p.swingDir = -p.swingDir;
}

function tryAttack(p) {
  if (p.atkCd > 0) return;
  if (p.cls === 'jedi') {
    // ЛКМ с погашенным мечом — зажигаем его
    if (!p.saberOn) { toggleSaber(p); return; }
    if (!saberReady(p)) return;
    p.atkCd = 0.3;
    startSwing(p);
    if (isAuth()) emit(['sw', p.idx]);
    else { playFx(['sw', p.idx]); send({ t: 'a', k: 'atk', s: G.seq, a: r2(p.a) }); }
  } else {
    if (p.overheat > 0) return;
    p.atkCd = 0.13;
    p.heat += 0.1;
    if (p.heat >= 1) { p.heat = 1; p.overheat = 1.4; SFX.overheat(); }
    if (isAuth()) playerFire(p);
    else {
      playFx(['shot', p.x + Math.cos(p.a) * 18, p.y + Math.sin(p.a) * 18, p.a, p.idx]);
      send({ t: 'a', k: 'fire', s: G.seq, a: r2(p.a) });
    }
  }
}

function trySpecial(p, wm) {
  if (p.spCd > 0) return;
  if (p.cls === 'jedi') {
    p.spCd = 3.5;
    if (isAuth()) doPush(p);
    else { playFx(['push', p.x, p.y, p.a, p.idx]); send({ t: 'a', k: 'push', s: G.seq, a: r2(p.a) }); }
  } else {
    p.spCd = 5;
    let dx = wm.x - p.x, dy = wm.y - p.y;
    const d = Math.hypot(dx, dy), maxD = 280;
    if (d > maxD) { dx *= maxD / d; dy *= maxD / d; }
    const tx = p.x + dx, ty = p.y + dy;
    if (isAuth()) throwNade(p, tx, ty);
    else { playFx(['nade', p.x, p.y, p.idx]); send({ t: 'a', k: 'nade', s: G.seq, a: r2(p.a), tx: r1(tx), ty: r1(ty) }); }
  }
}

// --- только хост/соло ---
function playerFire(p) {
  const a = p.a + rand(-0.03, 0.03);
  const x = p.x + Math.cos(a) * 16, y = p.y + Math.sin(a) * 16;
  p.flashT = MUZZLE_FLASH_T;   // вспышка выдаёт стрелка в темноте
  G.bullets.push({ x, y, vx: Math.cos(a) * 950, vy: Math.sin(a) * 950, f: true, o: p.idx, dmg: 1, life: 1.2 });
  emit(['shot', x, y, a, p.idx]);
  makeNoise(p.x, p.y, NOISE.blaster, true);
}

function doPush(p) {
  emit(['push', p.x, p.y, p.a, p.idx]);
  makeNoise(p.x, p.y, NOISE.push, false);
  for (const e of G.enemies) {
    if (e.dead) continue;
    const d = dist(p, e);
    const ang = Math.atan2(e.y - p.y, e.x - p.x);
    if (d < 190 && Math.abs(angDiff(ang, p.a)) < 0.85 && los(p.x, p.y, e.x, e.y)) {
      const force = 760 * (1 - d / 260);
      e.kvx = Math.cos(ang) * force; e.kvy = Math.sin(ang) * force;
      e.stun = 1.1; e.wind = 0; e.burst = 0; e.pushBy = p.idx;
      alarm(e, p.x, p.y);
    }
  }
  for (const b of G.bullets) {
    if (b.f) continue;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    const ang = Math.atan2(b.y - p.y, b.x - p.x);
    if (d < 190 && Math.abs(angDiff(ang, p.a)) < 0.9) reflectBullet(b, p, ang);
  }
}

function throwNade(p, tx, ty) {
  G.nades.push({ x: p.x, y: p.y, sx: p.x, sy: p.y, tx, ty, t: 0, o: p.idx });
  emit(['nade', p.x, p.y, p.idx]);
}

function reflectBullet(b, p, ang) {
  const sp = 900;
  b.vx = Math.cos(ang) * sp; b.vy = Math.sin(ang) * sp;
  b.f = true; b.o = p.idx; b.dmg = 3; b.life = 1.2;
  emit(['defl', b.x, b.y]);
}

// Шум: враги в радиусе r (по пути вокруг стен) слышат его.
// loud — выстрел/взрыв: сразу тревога. Иначе (шаги) — настораживаются и идут проверить.
function makeNoise(x, y, r, loud) {
  if (r <= 0) return;
  const maxD = Math.ceil(r / TILE);
  let field = null;
  for (const e of G.enemies) {
    if (e.dead || e.stun > 0) continue;
    if (Math.hypot(e.x - x, e.y - y) > r + TILE) continue;   // быстрый отсев до BFS
    field = field || bfsFrom(x, y, maxD);
    if (field.f[tileIndex(e.x, e.y)] > maxD) continue;
    if (loud || e.st === 2) {
      if (e.st !== 2) { e.st = 2; e.alertT = 1; }
    } else if (e.st === 0) { e.st = 1; e.susT = 1.2; }
    if (!e.saw) { e.goal = field; e.searchT = 0; }
  }
}

// враг узнал, откуда угроза (удар, толчок) — тревога и идём туда
function alarm(e, x, y) {
  if (e.st !== 2) { e.st = 2; e.alertT = 1; }
  if (!e.saw) { e.goal = bfsFrom(x, y, 60); e.searchT = 0; }
}

function damageEnemy(e, dmg, by) {
  if (e.dead) return;
  e.hp -= dmg;
  e.flash = 0.12;
  const attacker = G.players.find((p) => p.idx === by);
  if (attacker) alarm(e, attacker.x, attacker.y);
  if (e.hp > 0) { emit(['hit', e.x, e.y]); return; }
  e.dead = true;
  makeNoise(e.x, e.y, NOISE.death, false);   // предсмертный крик
  G.combo = G.comboT > 0 ? G.combo + 1 : 1;
  G.comboT = 3;
  G.score += ETYPES[e.t].score * G.combo;
  emit(['kill', e.x, e.y, ETYPES[e.t].color]);
}

function killPlayer(p) {
  if (p.dead) return;
  p.dead = true; p.revive = 0;
  emit(['pdie', p.x, p.y, playerColor(p.idx)]);
}

function explode(x, y, owner) {
  emit(['boom', x, y]);
  makeNoise(x, y, NOISE.boom, true);
  for (const e of G.enemies) {
    if (!e.dead && Math.hypot(e.x - x, e.y - y) < 105 && los(x, y, e.x, e.y)) damageEnemy(e, 3, owner);
  }
  G.bullets = G.bullets.filter((b) => b.f || Math.hypot(b.x - x, b.y - y) > 105);
}

// Сглаженная оценка скорости игрока по смещению за dt (рывок обрезаем — по нему не упреждают)
function trackVelocity(p, dt) {
  if (dt <= 0) return;
  if (p.px === undefined) { p.px = p.x; p.py = p.y; p.vx = 0; p.vy = 0; }
  let vx = (p.x - p.px) / dt, vy = (p.y - p.py) / dt;
  const sp = Math.hypot(vx, vy), max = 320;
  if (sp > max) { vx *= max / sp; vy *= max / sp; }
  const k = Math.min(1, dt * 10);
  p.vx += (vx - p.vx) * k; p.vy += (vy - p.vy) * k;
  p.px = p.x; p.py = p.y;
}

// Угол стрельбы с упреждением: решаем |D + V·t| = s·t, целимся в точку встречи.
// lead < 1 — враг немного недооценивает упреждение (резкий манёвр спасает).
function leadAngle(e, p, s, lead) {
  const dx = p.x - e.x, dy = p.y - e.y;
  const vx = (p.vx || 0) * lead, vy = (p.vy || 0) * lead;
  const a = vx * vx + vy * vy - s * s;
  const b = 2 * (dx * vx + dy * vy);
  const c = dx * dx + dy * dy;
  let t = -1;
  if (Math.abs(a) < 1e-6) t = b < 0 ? -c / b : -1;
  else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
      t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
    }
  }
  const direct = Math.atan2(dy, dx);
  if (!(t > 0) || t > 1.2) return direct;
  const ax = p.x + vx * t, ay = p.y + vy * t;
  // точка встречи за стеной — стрелять туда бессмысленно, бьём напрямую
  if (!los(e.x, e.y, ax, ay)) return direct;
  return Math.atan2(ay - e.y, ax - e.x);
}

function enemyFire(e, aim) {
  const T = ETYPES[e.t];
  const a = aim + rand(-T.spread, T.spread);
  const x = e.x + Math.cos(a) * 15, y = e.y + Math.sin(a) * 15;
  const sp = T.bolt;
  G.bullets.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, f: false, o: -1, dmg: 1, life: 2.5 });
  emit(['shot', x, y, a, -1]);
  makeNoise(e.x, e.y, NOISE.enemyShot, true);  // звуки боя подтягивают остальных
}

// ---------- ИИ врагов (хост) ----------
// Герой сейчас светится: горящий меч или недавняя вспышка выстрела
const playerLit = (p) => (p.cls === 'jedi' && p.saberLen > 0.3) || p.flashT > 0;

// Дальность, на которой враг может заметить героя: в темноте — только вблизи, если герой не светится
function sightRange(e, p) {
  if (!darkAt(p.x, p.y) || playerLit(p)) return ENEMY_SIGHT;
  return e.st === 2 ? DARK_SIGHT_ALERT : DARK_SIGHT;
}

// Идём по BFS-полю к его источнику. true — пришли (или туда не добраться).
function followField(e, goal, speed, dt) {
  const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
  const w = map.w, f = goal.f;
  const cur = f[ty * w + tx];
  if (cur >= 1e9) return true;
  let gx, gy;
  if (cur === 0) {
    gx = goal.x; gy = goal.y;
    if (Math.hypot(gx - e.x, gy - e.y) < 16) return true;
  } else {
    let best = cur, bx = tx, by = ty;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = tx + dx, ny = ty + dy;
        if (solidTile(nx, ny)) continue;
        if (dx && dy && (solidTile(tx + dx, ty) || solidTile(tx, ty + dy))) continue;
        const v = f[ny * w + nx] + (dx && dy ? 0.4 : 0);
        if (v < best) { best = v; bx = nx; by = ny; }
      }
    }
    if (bx === tx && by === ty) return true;
    gx = bx * TILE + TILE / 2; gy = by * TILE + TILE / 2;
  }
  const ang = Math.atan2(gy - e.y, gx - e.x);
  e.a = turnTo(e.a, ang, 6 * dt);
  moveCircle(e, Math.cos(ang) * speed * dt, Math.sin(ang) * speed * dt, ER);
  return false;
}

function updateEnemies(dt) {
  for (const e of G.enemies) {
    if (e.dead) continue;
    const T = ETYPES[e.t];
    e.flash = Math.max(0, e.flash - dt);
    e.alertT = Math.max(0, e.alertT - dt);
    e.susT = Math.max(0, e.susT - dt);

    if (e.stun > 0) {
      e.stun -= dt;
      const sp = Math.hypot(e.kvx, e.kvy);
      const hit = moveCircle(e, e.kvx * dt, e.kvy * dt, ER);
      if (hit && sp > 300) { damageEnemy(e, 3, e.pushBy); continue; }
      const k = Math.pow(0.03, dt);
      e.kvx *= k; e.kvy *= k;
      continue;
    }

    // ищем видимую цель
    let target = null, td = 1e9;
    for (const p of G.players) {
      if (p.dead) continue;
      const d = dist(e, p);
      if (d > sightRange(e, p) || d >= td) continue;
      // встревоженные смотрят по сторонам, насторожённые — шире обычного
      const fov = e.st === 2 ? 2.2 : e.st === 1 ? 1.4 : 1.05;
      const facing = Math.abs(angDiff(Math.atan2(p.y - e.y, p.x - e.x), e.a)) < fov;
      const glowSeen = p.cls === 'jedi' && p.saberLen > 0.3 && d < SABER_NOTICE;
      if ((facing || d < 70 || glowSeen) && los(e.x, e.y, p.x, p.y)) { target = p; td = d; }
    }

    if (target) {
      if (e.st !== 2) { e.st = 2; e.alertT = 1; e.react = -0.2; }
      e.saw = true; e.lastX = target.x; e.lastY = target.y;
      e.goal = null; e.searchT = 0;
      e.react += dt;
      const ta = Math.atan2(target.y - e.y, target.x - e.x);
      // стрелки доворачивают на точку упреждения, ближники — прямо на цель
      if (!e.lead || Math.random() < dt * 2) e.lead = rand(0.75, 1.0);
      const aim = T.melee ? ta : leadAngle(e, target, T.bolt, e.lead);
      e.a = turnTo(e.a, aim, 7 * dt);

      if (T.melee) {
        if (e.wind > 0) {
          e.wind -= dt;
          if (e.wind <= 0) {
            emit(['staff', e.x, e.y]);
            e.cd = 0.5;
            for (const p of G.players) {
              if (!p.dead && p.dash <= 0 && dist(e, p) < 42) killPlayer(p);
            }
          }
        } else {
          e.cd -= dt;
          if (td < 34 && e.cd <= 0 && e.react > 0) e.wind = 0.22;
          else if (td > 26) moveCircle(e, Math.cos(ta) * T.chase * dt, Math.sin(ta) * T.chase * dt, ER);
        }
      } else {
        if (td > 240) moveCircle(e, Math.cos(e.a) * T.speed * dt, Math.sin(e.a) * T.speed * dt, ER);
        if (e.burst > 0) {
          e.burstT -= dt;
          if (e.burstT <= 0) { enemyFire(e, aim); e.burst--; e.burstT = T.burstGap; }
        } else {
          e.cd -= dt;
          if (e.react > 0.35 && e.cd <= 0 && Math.abs(angDiff(aim, e.a)) < 0.12) {
            e.burst = T.burst; e.burstT = 0;
            e.cd = rand(T.fire[0], T.fire[1]);
          }
        }
      }
    } else {
      e.react = Math.min(e.react, 0);
      e.wind = 0; e.burst = 0;
      // потеряли из виду — идём туда, где видели в последний раз
      if (e.saw) { e.saw = false; e.goal = bfsFrom(e.lastX, e.lastY, 60); }
      if (e.goal) {
        const spd = e.st === 2 ? T.chase : T.speed * 1.2;
        if (followField(e, e.goal, spd, dt)) {
          e.goal = null;
          e.searchT = e.st === 2 ? 5 : 3;
          e.lookT = 0;
        }
      } else if (e.searchT > 0) {
        // обыскиваем место: крутим головой, потом успокаиваемся
        e.searchT -= dt;
        e.lookT -= dt;
        if (e.lookT <= 0) { e.look = e.a + rand(-2.4, 2.4); e.lookT = rand(0.6, 1.2); }
        e.a = turnTo(e.a, e.look, 4 * dt);
        if (e.searchT <= 0) e.st = 0;
      } else {
        e.lookT -= dt;
        if (e.lookT <= 0) { e.look = e.a + rand(-1.6, 1.6); e.lookT = rand(2, 4); }
        e.a = turnTo(e.a, e.look, 1.2 * dt);
      }
    }
  }
  // расталкиваем врагов
  const es = G.enemies;
  for (let i = 0; i < es.length; i++) {
    const a = es[i];
    if (a.dead) continue;
    for (let j = i + 1; j < es.length; j++) {
      const b = es[j];
      if (b.dead) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d > 0.01 && d < ER * 2) {
        const push = (ER * 2 - d) / 2;
        moveCircle(a, (-dx / d) * push, (-dy / d) * push, ER);
        moveCircle(b, (dx / d) * push, (dy / d) * push, ER);
      }
    }
  }
}

function updateBullets(dt) {
  const jedis = G.players.filter((p) => saberReady(p) && !p.dead && p.swing > 0);
  for (let i = G.bullets.length - 1; i >= 0; i--) {
    const b = G.bullets[i];
    const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 8));
    let dead = false;
    for (let s = 0; s < steps && !dead; s++) {
      b.x += (b.vx * dt) / steps; b.y += (b.vy * dt) / steps;
      if (solidAt(b.x, b.y)) {
        emit(['spark', b.x - b.vx * 0.005, b.y - b.vy * 0.005, b.f ? playerColor(b.o) : ENEMY_BOLT]);
        dead = true; break;
      }
      if (b.f) {
        for (const e of G.enemies) {
          if (!e.dead && Math.hypot(e.x - b.x, e.y - b.y) < ER + 3) { damageEnemy(e, b.dmg, b.o); dead = true; break; }
        }
      } else {
        let deflected = false;
        for (const p of jedis) {
          const d = Math.hypot(b.x - p.x, b.y - p.y);
          if (d < 50 && Math.abs(angDiff(Math.atan2(b.y - p.y, b.x - p.x), p.a)) < 1.6) {
            reflectBullet(b, p, p.a); deflected = true; break;
          }
        }
        if (deflected) continue;
        for (const p of G.players) {
          if (!p.dead && p.dash <= 0 && Math.hypot(p.x - b.x, p.y - b.y) < PR + 3) { killPlayer(p); dead = true; break; }
        }
      }
    }
    b.life -= dt;
    if (dead || b.life <= 0) G.bullets.splice(i, 1);
  }
}

function updateNades(dt) {
  for (let i = G.nades.length - 1; i >= 0; i--) {
    const n = G.nades[i];
    n.t += dt;
    const k = Math.min(1, n.t / 0.45);
    const nx = n.sx + (n.tx - n.sx) * k, ny = n.sy + (n.ty - n.sy) * k;
    // не пролетаем сквозь стены
    if (!solidAt(nx, ny)) { n.x = nx; n.y = ny; } else { n.sx = n.tx = n.x; n.sy = n.ty = n.y; }
    if (n.t >= 1.15) { explode(n.x, n.y, n.o); G.nades.splice(i, 1); }
  }
}

function updateAuthority(dt) {
  // меч джедая рубит всех в дуге, пока идёт взмах
  for (const p of G.players) {
    if (!saberReady(p) || p.dead || p.swing <= 0) continue;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const d = dist(p, e);
      if (d < 62 && Math.abs(angDiff(Math.atan2(e.y - p.y, e.x - p.x), p.a)) < 1.45) damageEnemy(e, 3, p.idx);
    }
  }

  // шаги игроков шумят: обычный шаг — умеренно, спринт и рывок — громко, крадучись — тихо
  for (const p of G.players) {
    const r = p.dead ? 0 : p.mv === MV.SPRINT ? NOISE.sprint : p.mv === MV.WALK ? NOISE.walk : 0;
    if (!r) { p.stepT = 0; continue; }
    p.stepT -= dt;
    if (p.stepT <= 0) { makeNoise(p.x, p.y, r, false); p.stepT = p.mv === MV.SPRINT ? 0.25 : 0.4; }
  }
  for (const p of G.players) if (!p.net) trackVelocity(p, dt);
  if (G.state === 'play') updateEnemies(dt);
  updateBullets(dt);
  updateNades(dt);

  G.comboT = Math.max(0, G.comboT - dt);
  if (G.comboT <= 0) G.combo = 0;

  if (G.state !== 'play') { G.overT += dt; return; }

  // подъём напарника
  for (const p of G.players) {
    if (!p.dead) continue;
    const helper = G.players.find((q) => !q.dead && dist(q, p) < 40);
    if (helper) {
      p.revive += dt;
      if (p.revive >= 1.6) { p.dead = false; p.revive = 0; emit(['rev', p.x, p.y, playerColor(p.idx)]); }
    } else p.revive = Math.max(0, p.revive - dt * 0.5);
  }

  if (G.players.length && G.players.every((p) => p.dead)) { G.state = 'over'; G.overT = 0; return; }

  if (map.hub) { updatePads(dt); return; }

  // миссия: зачистили — открываем выход и запускаем отсчёт до возврата на базу
  if (!G.exitOpen && G.enemies.every((e) => e.dead)) {
    G.exitOpen = true; G.returnT = RETURN_DELAY; emit(['open']);
  }
  if (G.exitOpen) {
    G.returnT -= dt;
    const onExit = map.exit && G.players.some((p) => !p.dead &&
      Math.floor(p.x / TILE) === map.exit.tx && Math.floor(p.y / TILE) === map.exit.ty);
    if (onExit || G.returnT <= 0) returnToHub(true);
  }
}

// База: стоим на площадке открытой миссии PAD_HOLD секунд — вылет
function updatePads(dt) {
  let on = null;
  for (const pad of map.pads) {
    if (!missionUnlocked(pad.lv)) continue;
    if (G.players.some((p) => !p.dead && Math.hypot(p.x - pad.x, p.y - pad.y) < 22)) { on = pad; break; }
  }
  if (!on) { G.pad = null; return; }
  if (!G.pad || G.pad.lv !== on.lv) G.pad = { lv: on.lv, t: 0 };
  G.pad.t += dt;
  if (G.pad.t >= PAD_HOLD) startLevel(on.lv);
}

// ---------- Эффекты (частицы + звук), общие для хоста и гостя ----------
function addPart(x, y, vx, vy, life, color, size, drag = 3) {
  if (G.parts.length > 1500) return;
  G.parts.push({ x, y, vx, vy, life, max: life, color, size, drag });
}
function burst(x, y, color, n, sp, life, size = 2) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = rand(0.2, 1) * sp;
    addPart(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.5, 1) * life, color, size);
  }
}
function addRing(x, y, r, color) {
  G.rings.push({ x, y, r, t: 0, color });
  if (G.rings.length > 60) G.rings.shift();
}
function addDecal(x, y, r, color) {
  G.decals.push({ x, y, r, color, rot: Math.random() * 6 });
  if (G.decals.length > 250) G.decals.shift();
}
function vol(x, y) {
  const p = me();
  if (!p) return 1;
  return clamp(1 - Math.hypot(p.x - x, p.y - y) / 950, 0.05, 1);
}

// хост: проиграть у себя и отправить гостю
function emit(ev) {
  playFx(ev, false);
  if (G.role === 'host') G.fxOut.push(ev.map((v) => (typeof v === 'number' ? r2(v) : v)));
}

function playFx(ev, remote) {
  const [k] = ev;
  switch (k) {
    case 'shot': {
      const [, x, y, a, o] = ev;
      if (remote && o === G.myIdx) return;
      const c = o < 0 ? ENEMY_BOLT : playerColor(o);
      for (let i = 0; i < 4; i++) {
        const aa = a + rand(-0.5, 0.5), s = rand(80, 220);
        addPart(x, y, Math.cos(aa) * s, Math.sin(aa) * s, 0.15, c, 2);
      }
      if (o < 0) SFX.eshot(vol(x, y)); else { SFX.blaster(vol(x, y)); addRing(x, y, NOISE.blaster, c); }
      break;
    }
    case 'sw': {
      const [, idx] = ev;
      const p = G.players.find((q) => q.idx === idx);
      if (remote) { if (idx === G.myIdx) return; if (p) startSwing(p); }
      SFX.swing(p ? vol(p.x, p.y) : 1);
      break;
    }
    case 'sab': {
      const [, idx, on] = ev;
      const p = G.players.find((q) => q.idx === idx);
      if (remote) { if (idx === G.myIdx) return; if (p) p.saberOn = !!on; }
      const v = p ? vol(p.x, p.y) : 1;
      if (on) {
        SFX.ignite(v);
        if (p) burst(p.x + Math.cos(p.a + 0.95) * 30, p.y + Math.sin(p.a + 0.95) * 30, playerColor(idx), 10, 140, 0.3);
      } else SFX.saberOff(v);
      break;
    }
    case 'push': {
      const [, x, y, a, o] = ev;
      if (remote && o === G.myIdx) return;
      for (let i = 0; i < 40; i++) {
        const aa = a + rand(-0.8, 0.8), s = rand(250, 600);
        addPart(x, y, Math.cos(aa) * s, Math.sin(aa) * s, 0.35, '#bfe9ff', 2, 5);
      }
      G.shake = Math.max(G.shake, 5);
      SFX.push(vol(x, y));
      break;
    }
    case 'nade': {
      const [, x, y, o] = ev;
      if (remote && o === G.myIdx) return;
      SFX.nade(vol(x, y));
      break;
    }
    case 'kill': {
      const [, x, y, c] = ev;
      burst(x, y, c, 26, 260, 0.6, 2.5);
      burst(x, y, '#ff5522', 12, 160, 0.4, 2);
      addDecal(x, y, rand(14, 20), c);
      G.shake = Math.max(G.shake, 4);
      SFX.kill(vol(x, y));
      break;
    }
    case 'hit': {
      const [, x, y] = ev;
      burst(x, y, '#ffd28a', 10, 200, 0.25);
      SFX.hit(vol(x, y));
      break;
    }
    case 'pdie': {
      const [, x, y, c] = ev;
      burst(x, y, c, 50, 340, 0.9, 3);
      addDecal(x, y, 22, c);
      G.shake = Math.max(G.shake, 10);
      SFX.pdie(vol(x, y));
      break;
    }
    case 'defl': {
      const [, x, y] = ev;
      burst(x, y, '#ffffff', 10, 260, 0.2);
      SFX.defl(vol(x, y));
      break;
    }
    case 'spark': {
      const [, x, y, c] = ev;
      burst(x, y, c, 5, 140, 0.18, 1.5);
      break;
    }
    case 'boom': {
      const [, x, y] = ev;
      burst(x, y, '#ffb000', 60, 420, 0.7, 3);
      burst(x, y, '#ff3d00', 40, 260, 0.9, 3);
      burst(x, y, '#ffffff', 20, 500, 0.25, 2);
      addDecal(x, y, 46, '#ff6a00');
      addRing(x, y, NOISE.boom, '#ffb000');
      G.shake = Math.max(G.shake, 14);
      SFX.boom(vol(x, y));
      break;
    }
    case 'staff': {
      const [, x, y] = ev;
      burst(x, y, '#ff2a5a', 14, 220, 0.25);
      SFX.staff(vol(x, y));
      break;
    }
    case 'rev': {
      const [, x, y, c] = ev;
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        addPart(x + Math.cos(a) * 30, y + Math.sin(a) * 30, -Math.cos(a) * 60, -Math.sin(a) * 60, 0.5, c, 2.5, 1);
      }
      SFX.rev(vol(x, y));
      break;
    }
    case 'open':
      G.toast = { text: 'МИССИЯ ВЫПОЛНЕНА', t: 2.5 };
      SFX.open();
      break;
  }
}

// ---------- Звук (синтез WebAudio) ----------
let AC = null, master = null, noiseBuf = null;
function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.4; master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { AC = null; }
}
function tone(type, f0, f1, dur, v) {
  if (!AC || v < 0.002) return;
  const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, v, ftype, freq) {
  if (!AC || v < 0.002) return;
  const t = AC.currentTime, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; f.type = ftype; f.frequency.value = freq;
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random() * 0.4); s.stop(t + dur + 0.02);
}
const SFX = {
  blaster: (v) => { tone('sawtooth', 1500, 180, 0.15, 0.14 * v); tone('square', 800, 120, 0.1, 0.05 * v); },
  eshot:   (v) => { tone('square', 1100, 170, 0.17, 0.07 * v); },
  // зажигание: нарастающий гул + шипение; гашение — затухающий гул вниз
  ignite:  (v) => { tone('sawtooth', 70, 190, 0.38, 0.15 * v); tone('square', 140, 380, 0.26, 0.05 * v);
                    noise(0.3, 0.12 * v, 'bandpass', 1300); tone('sine', 900, 2600, 0.12, 0.04 * v); },
  saberOff:(v) => { tone('sawtooth', 190, 45, 0.36, 0.13 * v); tone('square', 320, 90, 0.22, 0.04 * v);
                    noise(0.26, 0.08 * v, 'bandpass', 800); },
  swing:   (v) => { tone('sawtooth', 230, 85, 0.22, 0.1 * v); noise(0.18, 0.07 * v, 'bandpass', 1800); },
  defl:    (v) => { tone('square', 2400, 1200, 0.07, 0.09 * v); tone('sine', 3200, 1600, 0.12, 0.08 * v); },
  kill:    (v) => { noise(0.2, 0.22 * v, 'bandpass', 900); tone('sawtooth', 300, 60, 0.2, 0.07 * v); },
  hit:     (v) => { tone('square', 500, 200, 0.08, 0.1 * v); },
  pdie:    (v) => { tone('sawtooth', 420, 30, 0.7, 0.18 * v); noise(0.5, 0.22 * v, 'lowpass', 800); },
  boom:    (v) => { noise(0.9, 0.55 * v, 'lowpass', 500); tone('sine', 140, 30, 0.6, 0.4 * v); },
  push:    (v) => { noise(0.4, 0.3 * v, 'lowpass', 380); tone('sine', 260, 50, 0.4, 0.22 * v); },
  dash:    () => { noise(0.12, 0.1, 'highpass', 2500); },
  step:    (k) => { noise(0.05, 0.05 * k, 'lowpass', 700); },
  nade:    (v) => { tone('triangle', 600, 300, 0.1, 0.1 * v); },
  rev:     (v) => { tone('sine', 440, 880, 0.35, 0.14 * v); tone('sine', 660, 1320, 0.35, 0.07 * v); },
  open:    () => { tone('sine', 330, 660, 0.5, 0.13); tone('sine', 495, 990, 0.5, 0.09); },
  overheat:() => { tone('square', 300, 80, 0.4, 0.09); },
  staff:   (v) => { noise(0.15, 0.18 * v, 'bandpass', 3000); tone('sawtooth', 120, 60, 0.15, 0.09 * v); },
};

// Постоянный гул горящих мечей: по голосу на каждого джедая.
// Громкость зависит от длины клинка и расстояния, при взмахе гул выше и ярче.
const hums = new Map();
function makeHum() {
  const o1 = AC.createOscillator(), o2 = AC.createOscillator(), o3 = AC.createOscillator();
  const f = AC.createBiquadFilter(), g = AC.createGain(), g3 = AC.createGain();
  o1.type = 'sawtooth'; o2.type = 'sawtooth'; o3.type = 'sine';
  f.type = 'lowpass'; f.Q.value = 2; f.frequency.value = 380;
  g.gain.value = 0; g3.gain.value = 0.35;
  o1.connect(f); o2.connect(f); f.connect(g);
  o3.connect(g3).connect(g);
  g.connect(master);
  for (const o of [o1, o2, o3]) o.start();
  return { o1, o2, o3, f, g };
}
function updateHums() {
  if (!AC) return;
  const t = AC.currentTime;
  const active = new Set();
  if (G.role !== 'none' && map) {
    for (const p of G.players) {
      if (p.cls !== 'jedi') continue;
      active.add(p.idx);
      let h = hums.get(p.idx);
      if (!h) { h = makeHum(); hums.set(p.idx, h); }
      const len = p.dead ? 0 : p.saberLen;
      const sw = p.swing > 0 ? p.swing / SWING_T : 0;     // 1 → 0 за время взмаха
      const v = 0.05 * len * vol(p.x, p.y) * (1 + sw * 1.6);
      const fr = 88 + sw * 50 + Math.sin(G.time * 2.3 + p.idx) * 1.5;
      h.g.gain.setTargetAtTime(v, t, 0.03);
      h.o1.frequency.setTargetAtTime(fr, t, 0.03);
      h.o2.frequency.setTargetAtTime(fr * 1.012, t, 0.03);   // биения — «живой» гул
      h.o3.frequency.setTargetAtTime(fr * 2, t, 0.03);
      h.f.frequency.setTargetAtTime(380 + sw * 1500, t, 0.03);
    }
  }
  for (const [idx, h] of hums) {
    if (active.has(idx)) continue;
    h.g.gain.setTargetAtTime(0, t, 0.05);
    for (const o of [h.o1, h.o2, h.o3]) o.stop(t + 0.4);
    hums.delete(idx);
  }
}

// ---------- Сеть ----------
const Net = { peer: null, conn: null, code: '', sendT: 0, connected: false };

function send(msg) {
  if (Net.conn && Net.conn.open) { try { Net.conn.send(msg); } catch (e) { /* канал закрыт */ } }
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
    G.players = [makePlayer(0, G.cls)];
    G.progress = loadProgress();
    startLevel(0);
    hideMenu();
    G.toast = { text: `КОД КОМНАТЫ: ${code}`, t: 4 };
  });
  peer.on('connection', (c) => {
    if (Net.conn && Net.conn.open) {
      c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); });
      return;
    }
    Net.conn = c;
    c.on('data', onHostData);
    c.on('close', () => {
      if (Net.conn !== c) return;
      Net.conn = null; Net.connected = false;
      G.players = G.players.filter((p) => p.idx !== 1);
      G.toast = { text: 'НАПАРНИК ОТКЛЮЧИЛСЯ', t: 3 };
    });
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id') { peer.destroy(); hostGame(); return; }
    if (G.role === 'none') setStatus('Ошибка сети: ' + e.type);
    else G.toast = { text: 'Ошибка сети: ' + e.type, t: 3 };
  });
}

function onHostData(d) {
  if (!d || typeof d !== 'object') return;
  if (d.t === 'hello') {
    G.players = G.players.filter((p) => p.idx !== 1);
    const p = makePlayer(1, CLASSES[d.cls] ? d.cls : 'smuggler');
    p.net = true;
    placePlayer(p);
    // если хост уже ушёл далеко от старта — появляемся рядом с ним
    const host = me();
    if (host && !host.dead) { p.x = p.rx = host.x; p.y = p.ry = host.y; }
    G.players.push(p);
    Net.connected = true;
    send({ t: 'welcome', idx: 1 });
    G.toast = { text: 'НАПАРНИК ПОДКЛЮЧИЛСЯ', t: 3 };
    return;
  }
  const p = G.players.find((q) => q.idx === 1);
  if (!p) return;
  if (d.t === 'i') {
    if (d.s !== G.seq) return;
    if (!p.dead) { p.x = d.x; p.y = d.y; }
    const now = performance.now();
    if (p.lastIn) trackVelocity(p, Math.min(0.2, (now - p.lastIn) / 1000));
    else { p.px = p.x; p.py = p.y; }
    p.lastIn = now;
    p.a = d.a; p.dash = d.d ? 0.05 : 0; p.mv = d.m | 0;
    if (d.so !== undefined) p.saberOn = !!d.so;
  } else if (d.t === 'a') {
    if (d.s !== G.seq || p.dead || G.state !== 'play') return;
    p.a = d.a;
    if (d.k === 'sab') setSaber(p, d.on ? 1 : 0);
    else if (d.k === 'atk') { if (!p.saberOn) return; startSwing(p); emit(['sw', p.idx]); }
    else if (d.k === 'fire') playerFire(p);
    else if (d.k === 'push') doPush(p);
    else if (d.k === 'nade') throwNade(p, d.tx, d.ty);
  } else if (d.t === 'hub') {
    requestHub();
  } else if (d.t === 'r') {
    if (G.state !== 'play') requestRestart();
  }
}

function sendSnapshot() {
  send({
    t: 's', s: G.seq, lv: G.lv, gs: G.state, sc: G.score, rt: r2(G.returnT), pd: G.pad ? [G.pad.lv, r2(G.pad.t)] : 0,
    pr: G.progress.map((q) => [q.done ? 1 : 0, q.best]), ts: G.toast ? [G.toast.text, r2(G.toast.t)] : 0, cb: G.combo, ct: r2(G.comboT), ex: G.exitOpen ? 1 : 0,
    p: G.players.map((p) => [p.idx, p.cls, r1(p.x), r1(p.y), r2(p.a), p.dead ? 1 : 0, r2(p.revive), r2(p.heat), p.dash > 0 ? 1 : 0, p.mv, p.saberOn ? 1 : 0]),
    e: G.enemies.map((e) => [e.id, e.t, r1(e.x), r1(e.y), r2(e.a), e.dead ? 1 : 0, e.st, e.wind > 0 ? 1 : 0, e.flash > 0 ? 1 : 0, r2(e.alertT), r2(e.susT)]),
    b: G.bullets.map((b) => [r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), b.f ? 1 : 0, b.o]),
    g: G.nades.map((n) => [r1(n.x), r1(n.y), r2(n.t)]),
    fx: G.fxOut,
  });
  G.fxOut = [];
}

function joinGame(code) {
  if (!peerAvailable()) return;
  code = code.trim().toUpperCase();
  if (code.length !== 5) { setStatus('Введите 5-значный код комнаты'); return; }
  cleanupNet();
  setStatus('Подключаемся…');
  const peer = new Peer(undefined, { debug: 1 });
  Net.peer = peer;
  peer.on('open', () => {
    const c = peer.connect(PEER_PREFIX + code, { reliable: true });
    Net.conn = c;
    const timeout = setTimeout(() => {
      if (!Net.connected) { setStatus('Не удалось подключиться (таймаут). Проверьте код.'); cleanupNet(); }
    }, 12000);
    c.on('open', () => c.send({ t: 'hello', cls: G.cls }));
    c.on('data', (d) => {
      if (!d || typeof d !== 'object') return;
      if (d.t === 'full') { setStatus('Комната уже заполнена'); clearTimeout(timeout); cleanupNet(); return; }
      if (d.t === 'welcome') {
        clearTimeout(timeout);
        Net.connected = true; Net.code = code;
        G.role = 'guest'; G.myIdx = d.idx;
        G.players = []; G.lv = -1; G.seq = -1;
        hideMenu();
        return;
      }
      if (d.t === 's' && G.role === 'guest') applySnapshot(d);
    });
    c.on('close', () => { if (G.role === 'guest') leaveToMenu('Соединение с хостом потеряно'); });
  });
  peer.on('error', (e) => {
    if (e.type === 'peer-unavailable') setStatus('Комната не найдена. Проверьте код.');
    else setStatus('Ошибка сети: ' + e.type);
    if (G.role === 'guest') leaveToMenu('Ошибка сети: ' + e.type);
    else cleanupNet();
  });
}

function applySnapshot(s) {
  if (s.lv !== G.lv || s.s !== G.seq) {
    G.lv = s.lv; G.seq = s.s;
    buildMap(s.lv);
    G.enemies = []; G.bullets = []; G.nades = []; G.decals = []; G.parts = []; G.rings = [];
    G.titleT = 3;
    const mine = me();
    if (mine) { placePlayer(mine); G.cam.x = mine.x; G.cam.y = mine.y; }
  }
  G.returnT = s.rt; G.pad = s.pd ? { lv: s.pd[0], t: s.pd[1] } : null;
  G.progress = s.pr.map(([done, best]) => ({ done: !!done, best }));
  if (s.ts && (!G.toast || G.toast.text !== s.ts[0])) G.toast = { text: s.ts[0], t: s.ts[1] };
  G.state = s.gs; G.score = s.sc; G.combo = s.cb; G.comboT = s.ct; G.exitOpen = !!s.ex;

  // игроки
  const seen = new Set();
  for (const [idx, cls, x, y, a, dead, rv, heat, dash, mv, so] of s.p) {
    seen.add(idx);
    let p = G.players.find((q) => q.idx === idx);
    if (!p) {
      p = makePlayer(idx, cls);
      p.x = p.rx = x; p.y = p.ry = y;
      if (idx !== G.myIdx) p.net = true;
      G.players.push(p);
      if (idx === G.myIdx) { G.cam.x = x; G.cam.y = y; }
    }
    p.cls = cls; p.dead = !!dead; p.revive = rv;
    if (idx !== G.myIdx) { p.x = x; p.y = y; p.a = a; p.heat = heat; p.dash = dash ? 0.05 : 0; p.mv = mv | 0; p.saberOn = !!so; }
  }
  G.players = G.players.filter((p) => seen.has(p.idx));

  // враги
  const byId = new Map(G.enemies.map((e) => [e.id, e]));
  G.enemies = s.e.map(([id, t, x, y, a, dead, st, wind, flash, alertT, susT]) => {
    let e = byId.get(id);
    if (!e) e = { id, t, rx: x, ry: y };
    Object.assign(e, { x, y, a, dead: !!dead, st, wind: wind ? 0.1 : 0, flash: flash ? 0.05 : 0, alertT, susT });
    return e;
  });

  G.bullets = s.b.map(([x, y, vx, vy, f, o]) => ({ x, y, vx, vy, f: !!f, o }));
  G.nades = s.g.map(([x, y, t]) => ({ x, y, t }));
  for (const ev of s.fx) playFx(ev, true);
}

function cleanupNet() {
  try { if (Net.conn) Net.conn.close(); } catch (e) { /* ignore */ }
  try { if (Net.peer) Net.peer.destroy(); } catch (e) { /* ignore */ }
  Net.conn = null; Net.peer = null; Net.connected = false; Net.code = '';
}

function leaveToMenu(msg) {
  cleanupNet();
  G.role = 'none'; G.state = 'menu';
  G.players = []; G.enemies = []; G.bullets = []; G.nades = [];
  map = null;
  showMenu();
  setStatus(msg || '');
}

// ---------- Главный цикл ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  G.time += dt;
  if (G.role !== 'none' && map) update(dt);
  updateHums();
  render(dt);
  requestAnimationFrame(frame);
}

function update(dt) {
  const p = me();
  for (const q of G.players) tickPlayerTimers(q, dt);
  if (p) controlLocal(p, dt);

  if (isAuth()) {
    updateAuthority(dt);
    if (G.role === 'host') {
      Net.sendT -= dt * 1000;
      if (Net.sendT <= 0 && Net.conn && Net.conn.open && Net.connected) { sendSnapshot(); Net.sendT = SNAP_MS; }
      if (!Net.connected) G.fxOut = [];
    }
  } else {
    // гость: экстраполируем пули между снимками
    for (const b of G.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    G.bullets = G.bullets.filter((b) => !solidAt(b.x, b.y));
    Net.sendT -= dt * 1000;
    if (Net.sendT <= 0 && p) {
      send({ t: 'i', s: G.seq, x: r1(p.x), y: r1(p.y), a: r2(p.a), d: p.dash > 0 ? 1 : 0, m: p.mv, so: p.saberOn ? 1 : 0 });
      Net.sendT = INPUT_MS;
    }
  }

  // сглаживание сетевых позиций
  const k = Math.min(1, dt * 16);
  for (const q of G.players) {
    if (q.idx === G.myIdx && !q.net) { q.rx = q.x; q.ry = q.y; }
    else { q.rx += (q.x - q.rx) * k; q.ry += (q.y - q.ry) * k; }
  }
  for (const e of G.enemies) {
    if (isAuth()) { e.rx = e.x; e.ry = e.y; }
    else { e.rx += (e.x - e.rx) * k; e.ry += (e.y - e.ry) * k; }
  }

  // кольца шума шагов — визуальная подсказка, насколько громко идёт игрок
  for (const q of G.players) {
    const r = q.dead || G.state !== 'play' ? 0 : q.mv === MV.SPRINT ? NOISE.sprint : q.mv === MV.WALK ? NOISE.walk : 0;
    if (!r) { q.ringT = 0; continue; }
    q.ringT -= dt;
    if (q.ringT <= 0) {
      addRing(q.x, q.y, r, playerColor(q.idx));
      q.ringT = q.mv === MV.SPRINT ? 0.25 : 0.4;
      if (q.idx === G.myIdx) SFX.step(q.mv === MV.SPRINT ? 1 : 0.5);
    }
  }
  for (let i = G.rings.length - 1; i >= 0; i--) {
    G.rings[i].t += dt;
    if (G.rings[i].t >= 0.6) G.rings.splice(i, 1);
  }

  // частицы
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const q = G.parts[i];
    q.life -= dt;
    if (q.life <= 0) { G.parts.splice(i, 1); continue; }
    q.x += q.vx * dt; q.y += q.vy * dt;
    const dr = Math.exp(-q.drag * dt);
    q.vx *= dr; q.vy *= dr;
  }

  // камера: игрок + смещение к курсору
  if (p) {
    const tx = p.x + (mouse.x - VW / 2) * 0.3, ty = p.y + (mouse.y - VH / 2) * 0.3;
    const ck = Math.min(1, dt * 8);
    G.cam.x += (tx - G.cam.x) * ck; G.cam.y += (ty - G.cam.y) * ck;
  }
  G.shake = Math.max(0, G.shake - dt * 30);
  G.titleT = Math.max(0, G.titleT - dt);
  if (G.toast) { G.toast.t -= dt; if (G.toast.t <= 0) G.toast = null; }
}

// ---------- Отрисовка ----------
function glow(color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
function noGlow() { ctx.shadowBlur = 0; }

// Туман войны: всё вне радиуса вокруг игроков затемнено, враги там не рисуются
const fogC = document.createElement('canvas');
const fogX = fogC.getContext('2d');
const visC = document.createElement('canvas');
const visX = visC.getContext('2d');
const polyC = document.createElement('canvas');
const polyX = polyC.getContext('2d');

// Наблюдатели: герои (видят по прямой в светлых зонах + радиус в тёмных) и свет мечей (только радиус)
function fogViewers() {
  const base = FOG_SHARED ? G.players : [me()].filter(Boolean);
  const v = base.map((p) => ({ rx: p.rx, ry: p.ry, r: FOG_R, eye: true }));
  for (const p of base) {
    const L = saberLight(p);
    if (L) v.push({ rx: L.x, ry: L.y, r: L.r, eye: false });
  }
  return v;
}
// 0..1 — насколько точка видна. В любом случае нужна прямая видимость от героя (стены закрывают обзор).
// Светлая зона: этого достаточно, дальность не ограничена.
// Тёмная комната: ещё и в радиусе обзора/света меча — полностью до 65% радиуса, дальше плавно исчезает.
function visibility(x, y, viewers) {
  let seen = false;
  for (const v of viewers) if (v.eye && los(v.rx, v.ry, x, y)) { seen = true; break; }
  if (!seen) return 0;
  if (!darkAt(x, y)) return 1;
  let best = 0;
  for (const v of viewers) {
    const d = Math.hypot(x - v.rx, y - v.ry);
    best = Math.max(best, clamp((v.r - d) / (v.r * 0.35), 0, 1));
  }
  return best;
}

// Луч по тайловой сетке (DDA): расстояние до первой стены
function castRay(ox, oy, dx, dy, maxR) {
  let tx = Math.floor(ox / TILE), ty = Math.floor(oy / TILE);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tdX = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
  const tdY = dy !== 0 ? Math.abs(TILE / dy) : Infinity;
  let tmX = dx > 0 ? ((tx + 1) * TILE - ox) / dx : dx < 0 ? (tx * TILE - ox) / dx : Infinity;
  let tmY = dy > 0 ? ((ty + 1) * TILE - oy) / dy : dy < 0 ? (ty * TILE - oy) / dy : Infinity;
  let t = 0;
  while (t < maxR) {
    if (tmX < tmY) { t = tmX; tmX += tdX; tx += stepX; } else { t = tmY; tmY += tdY; ty += stepY; }
    if (solidTile(tx, ty)) return t;
  }
  return maxR;
}

// Многоугольник видимости из точки: лучи до стен (чуть заходим в стену, чтобы открыть её кромку)
const VIS_RAYS = 720;
function drawVisPolygon(g, ox, oy, offX, offY, maxR) {
  g.beginPath();
  for (let i = 0; i < VIS_RAYS; i++) {
    const a = (i / VIS_RAYS) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    const d = Math.min(maxR, castRay(ox, oy, dx, dy, maxR) + 8);
    const x = ox + dx * d + offX, y = oy + dy * d + offY;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
}
function drawFog(offX, offY, viewers) {
  if (fogC.width !== VW || fogC.height !== VH) { fogC.width = VW; fogC.height = VH; }
  fogX.globalCompositeOperation = 'source-over';
  fogX.clearRect(0, 0, VW, VH);
  fogX.fillStyle = 'rgba(2,1,6,0.9)';
  fogX.fillRect(0, 0, VW, VH);
  if (visC.width !== VW || visC.height !== VH) { visC.width = VW; visC.height = VH; }
  if (polyC.width !== VW || polyC.height !== VH) { polyC.width = VW; polyC.height = VH; }

  // многоугольники прямой видимости героев — общая основа для обеих зон
  polyX.clearRect(0, 0, VW, VH);
  polyX.fillStyle = '#fff';
  const maxR = Math.hypot(VW, VH);
  for (const v of viewers) if (v.eye) drawVisPolygon(polyX, v.rx, v.ry, offX, offY, maxR);

  // 1) светлые зоны: прямая видимость ∩ маска светлых зон
  visX.globalCompositeOperation = 'source-over';
  visX.clearRect(0, 0, VW, VH);
  visX.drawImage(polyC, 0, 0);
  visX.globalCompositeOperation = 'destination-in';
  visX.drawImage(map.litMask, offX, offY);
  fogX.globalCompositeOperation = 'destination-out';
  fogX.drawImage(visC, 0, 0);

  // 2) тёмные комнаты: (радиус вокруг героев и свет мечей) ∩ маска тёмных зон ∩ прямая видимость
  visX.globalCompositeOperation = 'source-over';
  visX.clearRect(0, 0, VW, VH);
  for (const v of viewers) {
    const x = v.rx + offX, y = v.ry + offY;
    const g = visX.createRadialGradient(x, y, v.r * 0.55, x, y, v.r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    visX.fillStyle = g;
    visX.fillRect(x - v.r, y - v.r, v.r * 2, v.r * 2);
  }
  visX.globalCompositeOperation = 'destination-in';
  visX.drawImage(map.darkMask, offX, offY);
  visX.drawImage(polyC, 0, 0);
  fogX.drawImage(visC, 0, 0);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(fogC, 0, 0);
  ctx.restore();
}

function drawRings() {
  ctx.save();
  for (const r of G.rings) {
    const k = r.t / 0.6;
    const rad = r.r * (1 - (1 - k) * (1 - k));
    ctx.globalAlpha = (1 - k) * 0.35;
    ctx.strokeStyle = r.color; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function render(dt = 1 / 60) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#05030a';
  ctx.fillRect(0, 0, VW, VH);
  if (G.role === 'none' || !map) { renderMenuBackdrop(); return; }

  const sx = rand(-G.shake, G.shake), sy = rand(-G.shake, G.shake);
  const offX = Math.round(VW / 2 - G.cam.x + sx), offY = Math.round(VH / 2 - G.cam.y + sy);
  ctx.setTransform(1, 0, 0, 1, offX, offY);
  const viewers = fogViewers();

  ctx.drawImage(map.canvas, 0, 0);

  // следы от взрывов и смертей
  for (const d of G.decals) {
    const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
    g.addColorStop(0, rgba(d.color, 0.28));
    g.addColorStop(1, rgba(d.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
  }

  for (const e of G.enemies) if (e.dead) drawCorpse(e);
  for (const n of G.nades) drawNade(n);
  for (const e of G.enemies) {
    if (e.dead) continue;
    const target = visibility(e.rx, e.ry, viewers);
    if (e.va === undefined) e.va = target;
    e.va += (target - e.va) * Math.min(1, dt * 14);   // плавно проявляются из-за угла
    if (e.va > 0.01) drawEnemy(e, e.va);
  }
  for (const p of G.players) drawPlayer(p);
  drawFog(offX, offY, viewers);
  // поверх тумана: свет мечей, выход, шум, светящиеся выстрелы и вспышки
  drawSaberLights();
  drawPads();
  drawExit();
  drawRings();
  drawBullets();
  drawParticles();
  drawExitArrow();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawHUD();
  drawCrosshair();
}

function renderMenuBackdrop() {
  // медленно плывущие звёзды за меню
  const t = G.time;
  for (let i = 0; i < 120; i++) {
    const x = ((i * 137.5 + t * (10 + (i % 7) * 6)) % (VW + 40)) - 20;
    const y = (i * 71.3) % VH;
    ctx.fillStyle = i % 9 === 0 ? '#ff2bd6' : i % 5 === 0 ? '#33ccff' : '#ffffff';
    ctx.globalAlpha = 0.3 + (i % 4) * 0.15;
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.globalAlpha = 1;
}

function drawExit() {
  if (!map.exit) return;
  const { tx, ty } = map.exit;
  const X = tx * TILE, Y = ty * TILE;
  const c = G.exitOpen ? '#3dff8a' : '#444055';
  ctx.save();
  if (G.exitOpen) glow(c, 20 + Math.sin(G.time * 6) * 8);
  ctx.strokeStyle = c; ctx.lineWidth = 2;
  ctx.strokeRect(X + 3, Y + 3, TILE - 6, TILE - 6);
  ctx.globalAlpha = G.exitOpen ? 0.25 + Math.sin(G.time * 6) * 0.1 : 0.1;
  ctx.fillStyle = c; ctx.fillRect(X + 3, Y + 3, TILE - 6, TILE - 6);
  ctx.restore();
}

function drawPads() {
  if (!map.pads.length) return;
  for (const pad of map.pads) {
    const L = LEVELS[pad.lv], pr = G.progress[pad.lv] || { done: false, best: 0 };
    const open = missionUnlocked(pad.lv);
    const c = open ? L.color : '#3a3450';
    const X = pad.tx * TILE, Y = pad.ty * TILE;
    const pulse = open ? 0.5 + Math.sin(G.time * 3 + pad.lv) * 0.3 : 0.2;
    ctx.save();
    glow(c, open ? 18 : 0);
    ctx.strokeStyle = c; ctx.lineWidth = 2;
    ctx.strokeRect(X - 8, Y - 8, TILE + 16, TILE + 16);
    ctx.globalAlpha = 0.12 + pulse * 0.15;
    ctx.fillStyle = c; ctx.fillRect(X - 8, Y - 8, TILE + 16, TILE + 16);
    ctx.globalAlpha = 1;
    // прогресс вылета
    if (G.pad && G.pad.lv === pad.lv) {
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, 30, -Math.PI / 2, -Math.PI / 2 + (G.pad.t / PAD_HOLD) * Math.PI * 2);
      ctx.stroke();
    }
    noGlow();
    ctx.textAlign = 'center';
    ctx.font = "13px 'Russo One', sans-serif";
    ctx.fillStyle = open ? '#ffffff' : '#6a6280';
    ctx.fillText(`МИССИЯ ${pad.lv}`, pad.x, Y - 34);
    ctx.font = "15px 'Russo One', sans-serif";
    glow(c, open ? 10 : 0);
    ctx.fillStyle = c;
    ctx.fillText(L.name, pad.x, Y - 16);
    noGlow();
    ctx.font = '11px Consolas, monospace';
    ctx.fillStyle = !open ? '#6a6280' : pr.done ? '#3dff8a' : '#b9b0d6';
    ctx.fillText(!open ? 'ЗАКРЫТО — пройди предыдущую' : pr.done ? `✓ ВЫПОЛНЕНА · ЛУЧШИЙ СЧЁТ ${pr.best}` : 'встань на площадку', pad.x, Y + TILE + 24);
    ctx.restore();
  }
}

function drawExitArrow() {
  const p = me();
  if (!G.exitOpen || !map.exit || !p || p.dead) return;
  const d = Math.hypot(map.exit.x - p.rx, map.exit.y - p.ry);
  if (d < 80) return;
  const a = Math.atan2(map.exit.y - p.ry, map.exit.x - p.rx);
  ctx.save();
  ctx.translate(p.rx + Math.cos(a) * 38, p.ry + Math.sin(a) * 38);
  ctx.rotate(a);
  glow('#3dff8a', 12);
  ctx.fillStyle = '#3dff8a';
  ctx.globalAlpha = 0.6 + Math.sin(G.time * 8) * 0.3;
  ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, -6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawPlayer(p) {
  const c = playerColor(p.idx);
  ctx.save();
  ctx.translate(p.rx, p.ry);
  if (p.dead) {
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = c; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-8, -8); ctx.lineTo(8, 8); ctx.moveTo(8, -8); ctx.lineTo(-8, 8); ctx.stroke();
    ctx.globalAlpha = 0.35 + Math.sin(G.time * 5) * 0.2;
    ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2); ctx.setLineDash([4, 6]); ctx.stroke(); ctx.setLineDash([]);
    if (p.revive > 0) {
      ctx.globalAlpha = 1; glow(c, 12); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, 18, -Math.PI / 2, -Math.PI / 2 + (p.revive / 1.6) * Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // оружие
  if (p.cls === 'jedi') drawSaber(p, c);
  else {
    ctx.save(); ctx.rotate(p.a);
    ctx.strokeStyle = '#c8c8d8'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(6, 4); ctx.lineTo(21, 4); ctx.stroke();
    ctx.restore();
  }

  // тело
  glow(c, 16);
  ctx.fillStyle = rgba(c, 0.18);
  ctx.strokeStyle = c; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, PR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // «нос» — направление взгляда
  ctx.rotate(p.a);
  ctx.fillStyle = c;
  ctx.beginPath(); ctx.moveTo(PR + 4, 0); ctx.lineTo(PR - 3, -4); ctx.lineTo(PR - 3, 4); ctx.closePath(); ctx.fill();
  noGlow();

  // перегрев бластера
  if (p.cls === 'smuggler' && p.heat > 0.02) {
    ctx.rotate(-p.a);
    const hc = p.overheat > 0 ? '#ff3333' : p.heat > 0.7 ? '#ff8800' : '#ffd000';
    ctx.strokeStyle = hc; ctx.lineWidth = 2; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(0, 0, PR + 6, -Math.PI / 2, -Math.PI / 2 + p.heat * Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

// Текущий угол клинка (и дуга следа во время взмаха)
function saberPose(p) {
  if (p.swing > 0) {
    const k = 1 - p.swing / SWING_T;
    const start = p.a - p.swingDir * 1.45;
    const ang = start + p.swingDir * 2.9 * k;
    return { ang, trail: [start, ang] };
  }
  return { ang: p.a + 0.95, trail: null };  // меч держим сбоку
}

// Источник света клинка: центр на середине клинка, радиус мерцает и растёт при взмахе
function saberLight(p) {
  if (p.cls !== 'jedi' || p.dead || p.saberLen <= 0.01) return null;
  const { ang } = saberPose(p);
  const len = p.saberLen;
  const flicker = 1 + Math.sin(G.time * 31 + p.idx * 7) * 0.05 + Math.sin(G.time * 13.7) * 0.04;
  const swing = p.swing > 0;
  return {
    x: p.rx + Math.cos(ang) * (10 + 20 * len), y: p.ry + Math.sin(ang) * (10 + 20 * len),
    r: SABER_REVEAL * len * (swing ? 1.1 : 1) * (1 + (flicker - 1) * 0.4),
    flicker: flicker * len, boost: swing ? 1.6 : 1,
  };
}

// Свет от клинка: цветное пятно на полу/стенах, мерцает, при взмахе ярче.
// Рисуется поверх тумана (аддитивно), поэтому меч виден и издалека.
function drawSaberLights() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of G.players) {
    const L = saberLight(p);
    if (!L) continue;
    const c = playerColor(p.idx);
    const { x, y, flicker, boost } = L;
    const R = L.r * 0.95;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, rgba(c, 0.30 * flicker * boost));
    g.addColorStop(0.2, rgba(c, 0.13 * flicker * boost));
    g.addColorStop(0.6, rgba(c, 0.045 * flicker * boost));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - R, y - R, R * 2, R * 2);
  }
  ctx.restore();
}

function drawSaber(p, c) {
  const { ang, trail } = saberPose(p);
  const len = p.saberLen;
  // рукоять
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#9a9aae'; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(Math.cos(ang) * 3, Math.sin(ang) * 3); ctx.lineTo(Math.cos(ang) * 11, Math.sin(ang) * 11); ctx.stroke();
  ctx.restore();
  if (len <= 0.01) return;
  if (trail) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = c; glow(c, 20);
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.arc(0, 0, 50, Math.min(trail[0], trail[1]), Math.max(trail[0], trail[1]));
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  const x0 = Math.cos(ang) * 10, y0 = Math.sin(ang) * 10;
  const x1 = Math.cos(ang) * (10 + 40 * len), y1 = Math.sin(ang) * (10 + 40 * len);
  ctx.save();
  ctx.lineCap = 'round';
  glow(c, 22);
  ctx.strokeStyle = c; ctx.lineWidth = 6; ctx.globalAlpha = 0.8;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.restore();
}

function drawEnemy(e, vis) {
  const T = ETYPES[e.t];
  const c = e.flash > 0 ? '#ffffff' : T.color;
  ctx.save();
  ctx.globalAlpha = vis;
  ctx.translate(e.rx, e.ry);

  // конус обзора у спокойных — подсказка для стелса
  if (e.st === 0) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 120);
    g.addColorStop(0, 'rgba(255,255,255,0.07)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 120, e.a - 1.05, e.a + 1.05); ctx.closePath(); ctx.fill();
  }

  ctx.rotate(e.a);
  if (e.t === 'M') {
    // электропосох
    const hot = e.wind > 0;
    glow('#ff2a5a', hot ? 24 : 10);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(4, -16); ctx.lineTo(10, 16); ctx.stroke();
    ctx.fillStyle = hot ? '#fff' : '#ff2a5a';
    ctx.beginPath(); ctx.arc(4, -16, 3, 0, Math.PI * 2); ctx.arc(10, 16, 3, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.strokeStyle = '#8a8aa0'; ctx.lineWidth = e.t === 'H' ? 6 : 4;
    ctx.beginPath(); ctx.moveTo(6, 5); ctx.lineTo(e.t === 'H' ? 24 : 20, 5); ctx.stroke();
  }
  noGlow();

  // тело + шлем
  glow(c, 12);
  ctx.fillStyle = '#16121f'; ctx.strokeStyle = c; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, e.t === 'H' ? ER + 2 : ER, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  noGlow();
  ctx.fillStyle = e.t === 'M' ? '#ff2a5a' : '#111';
  ctx.fillRect(3, -5, 6, 3); ctx.fillRect(3, 2, 6, 3);   // «визор»
  if (e.t === 'H') { ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, ER - 4, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();

  // «!» — тревога, «?» — что-то услышал и идёт проверить (держится, пока насторожен)
  const mark = e.alertT > 0 ? '!' : e.st === 1 ? '?' : '';
  if (mark) {
    const mc = mark === '!' ? '#ff3344' : '#ffd000';
    ctx.save();
    ctx.fillStyle = mc; glow(mc, 10);
    ctx.font = "18px 'Russo One', sans-serif"; ctx.textAlign = 'center';
    ctx.globalAlpha = vis * (mark === '!' ? Math.min(1, e.alertT * 2) : 0.6 + 0.4 * Math.min(1, e.susT * 2));
    ctx.fillText(mark, e.rx, e.ry - 20);
    ctx.restore();
  }
}

function drawCorpse(e) {
  const c = ETYPES[e.t].color;
  ctx.save();
  ctx.translate(e.rx, e.ry); ctx.rotate(e.a);
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = c; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, 0, ER + 3, ER - 3, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(5, 5); ctx.moveTo(5, -5); ctx.lineTo(-5, 5); ctx.stroke();
  ctx.restore();
}

function drawNade(n) {
  const blink = Math.sin(n.t * (10 + n.t * 25)) > 0;
  ctx.save();
  glow('#ff3d00', blink ? 18 : 6);
  ctx.fillStyle = blink ? '#ffb000' : '#663300';
  ctx.strokeStyle = '#ffb000'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(n.x, n.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (n.t > 0.45) {
    ctx.globalAlpha = 0.15; ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.arc(n.x, n.y, 105, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function drawBullets() {
  ctx.save();
  ctx.lineCap = 'round';
  for (const b of G.bullets) {
    const c = b.f ? playerColor(b.o) : ENEMY_BOLT;
    const tx = b.x - b.vx * 0.028, ty = b.y - b.vy * 0.028;
    glow(c, 14);
    ctx.strokeStyle = c; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
    noGlow();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const q of G.parts) {
    ctx.globalAlpha = Math.max(0, q.life / q.max);
    ctx.fillStyle = q.color;
    const s = q.size;
    ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
  }
  ctx.restore();
}

function hudText(text, x, y, size, color, align = 'left', blur = 10) {
  ctx.font = `${size}px 'Russo One', Consolas, sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  glow(color, blur);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  noGlow();
}

function drawBar(x, y, w, h, k, color, label) {
  ctx.strokeStyle = rgba(color, 0.6); ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.fillStyle = color; glow(color, 8);
  ctx.fillRect(x + 2, y + 2, Math.max(0, (w - 3) * clamp(k, 0, 1)), h - 3);
  noGlow();
  ctx.font = '11px Consolas, monospace'; ctx.fillStyle = '#b9b0d6'; ctx.textAlign = 'left';
  ctx.fillText(label, x, y - 4);
}

function drawHUD() {
  const p = me();
  hudText(map.name, 20, 34, 18, map.color);
  if (map.hub) {
    const done = G.progress.filter((q, i) => !LEVELS[i].hub && q.done).length;
    const total = LEVELS.filter((L) => !L.hub).length;
    const best = G.progress.reduce((a, q) => a + q.best, 0);
    hudText(`МИССИЙ ВЫПОЛНЕНО: ${done}/${total} · ОЧКИ: ${best}`, 20, 62, 14, '#ffffff', 'left', 6);
    hudText('ВЫБЕРИ МИССИЮ — ВСТАНЬ НА ПЛОЩАДКУ', VW - 20, 34, 15, '#9d8cff', 'right', 8);
  } else {
    hudText(`СЧЁТ ${G.score}`, 20, 62, 16, '#ffffff', 'left', 6);
    if (G.combo > 1) hudText(`КОМБО x${G.combo}`, 20, 88, 16 + Math.min(G.combo, 6) * 2, '#ffb000');
    const left = G.enemies.filter((e) => !e.dead).length;
    hudText(G.exitOpen ? 'МИССИЯ ВЫПОЛНЕНА' : `ВРАГОВ: ${left}`, VW - 20, 34, 15, G.exitOpen ? '#3dff8a' : '#ff3344', 'right', 8);
    if (G.exitOpen && G.state === 'play') {
      hudText(`ВОЗВРАЩЕНИЕ НА БАЗУ ЧЕРЕЗ ${Math.max(0, Math.ceil(G.returnT))} · ИЛИ ИДИ К ВЫХОДУ`, VW / 2, 70, 16, '#3dff8a', 'center', 10);
    }
  }

  // сетевой статус
  let net = 'ОДИНОЧНАЯ ИГРА';
  if (G.role === 'host') net = Net.connected ? `КОМНАТА ${Net.code} · НАПАРНИК В ИГРЕ` : `КОМНАТА ${Net.code} · ЖДЁМ НАПАРНИКА`;
  if (G.role === 'guest') net = `КОМНАТА ${Net.code} · ГОСТЬ`;
  hudText(net, VW - 20, 58, 11, G.role === 'host' && !Net.connected ? '#ff2bd6' : '#7d74a0', 'right', 4);

  // перезарядки
  if (p) {
    const y = VH - 30;
    hudText(CLASSES[p.cls].name, 20, y - 30, 13, playerColor(p.idx), 'left', 6);
    const nz = p.dead ? null : [
      ['ТИШИНА', '#7d74a0'], ['КРАДЁШЬСЯ — БЕСШУМНО', '#3dff8a'],
      ['ШАГИ — СЛЫШНО РЯДОМ', '#ffd000'], ['БЕГ — ГРОМКО', '#ff3344'],
    ][p.mv];
    if (nz) hudText(nz[0], 200, y - 30, 12, nz[1], 'left', 6);
    if (!p.dead && darkAt(p.x, p.y)) {
      const lit = playerLit(p);
      hudText(lit ? 'ТЕБЯ ВЫДАЁТ СВЕТ' : 'В ТЕНИ — ЗАМЕТЯТ ТОЛЬКО ВБЛИЗИ', 200, y - 52, 11, lit ? '#ffb000' : '#9d8cff', 'left', 6);
    }
    if (p.cls === 'jedi') {
      hudText(p.saberOn ? 'МЕЧ ГОРИТ · F — ПОГАСИТЬ' : 'МЕЧ ПОГАШЕН · F — ЗАЖЕЧЬ', 20, y - 52, 11,
        p.saberOn ? playerColor(p.idx) : '#7d74a0', 'left', 4);
    }
    drawBar(20, y, 110, 10, 1 - p.dashCd / 0.8, '#33ccff', 'РЫВОК');
    drawBar(145, y, 110, 10, p.stam, p.exh ? '#ff3344' : '#3dff8a', p.exh ? 'ОДЫШКА' : 'ВЫНОСЛИВОСТЬ');
    if (p.cls === 'jedi') drawBar(270, y, 110, 10, 1 - p.spCd / 3.5, '#bfe9ff', 'ТОЛЧОК СИЛЫ');
    else {
      drawBar(270, y, 110, 10, 1 - p.spCd / 5, '#ffb000', 'ДЕТОНАТОР');
      drawBar(395, y, 110, 10, p.heat, p.overheat > 0 ? '#ff3333' : '#ffd000', p.overheat > 0 ? 'ПЕРЕГРЕВ!' : 'НАГРЕВ');
    }
  }

  // название уровня
  if (G.titleT > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, G.titleT);
    hudText(map.hub ? 'ХАБ' : `МИССИЯ ${G.lv}`, VW / 2, VH / 2 - 60, 18, '#ffffff', 'center', 6);
    hudText(map.name, VW / 2, VH / 2 - 20, 40, map.color, 'center', 24);
    ctx.restore();
  }

  if (G.toast) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, G.toast.t * 2);
    hudText(G.toast.text, VW / 2, 110, 20, '#3dff8a', 'center', 14);
    ctx.restore();
  }

  if (G.state === 'over' || G.state === 'win') {
    ctx.fillStyle = 'rgba(5,3,10,0.55)';
    ctx.fillRect(0, 0, VW, VH);
    if (G.state === 'over') {
      hudText('ВЫ ПОГИБЛИ', VW / 2, VH / 2, 54, '#ff3344', 'center', 30);
    } else {
      hudText('ГАЛАКТИКА СПАСЕНА', VW / 2, VH / 2 - 10, 46, '#ffb000', 'center', 30);
      hudText(`ИТОГОВЫЙ СЧЁТ ${G.score}`, VW / 2, VH / 2 + 34, 20, '#ffffff', 'center', 8);
    }
    if (G.overT > 0.6 || G.role === 'guest') {
      hudText('R — ЗАНОВО   ·   H — НА БАЗУ   ·   ESC — В МЕНЮ', VW / 2, VH / 2 + 80, 15, '#b9b0d6', 'center', 4);
    }
  } else if (p && p.dead) {
    hudText('ВЫ ПАЛИ — НАПАРНИК МОЖЕТ ВАС ПОДНЯТЬ', VW / 2, VH - 70, 15, '#ff3344', 'center', 10);
  }
}

function drawCrosshair() {
  const p = me();
  const c = p ? playerColor(p.idx) : '#fff';
  ctx.save();
  ctx.translate(mouse.x, mouse.y);
  glow(c, 10);
  ctx.strokeStyle = c; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.moveTo(-14, 0); ctx.lineTo(-5, 0); ctx.moveTo(5, 0); ctx.lineTo(14, 0);
  ctx.moveTo(0, -14); ctx.lineTo(0, -5); ctx.moveTo(0, 5); ctx.lineTo(0, 14);
  ctx.stroke();
  ctx.restore();
}

// ---------- Меню ----------
const menuEl = document.getElementById('menu');
const statusEl = document.getElementById('status');
const descEl = document.getElementById('clsDesc');
function setStatus(t) { statusEl.textContent = t; }
function hideMenu() { menuEl.classList.add('hidden'); canvas.classList.add('playing'); setStatus(''); }
function showMenu() { menuEl.classList.remove('hidden'); canvas.classList.remove('playing'); }

for (const b of document.querySelectorAll('button.cls')) {
  b.addEventListener('click', () => {
    G.cls = b.dataset.cls;
    for (const o of document.querySelectorAll('button.cls')) o.classList.toggle('sel', o === b);
    descEl.textContent = CLASSES[G.cls].desc;
  });
}
descEl.textContent = CLASSES[G.cls].desc;

document.getElementById('btnSolo').addEventListener('click', () => {
  initAudio();
  G.role = 'solo'; G.myIdx = 0;
  G.players = [makePlayer(0, G.cls)];
  G.progress = loadProgress();
  startLevel(0);
  hideMenu();
});
document.getElementById('btnHost').addEventListener('click', () => { initAudio(); hostGame(); });
document.getElementById('btnJoin').addEventListener('click', () => { initAudio(); joinGame(document.getElementById('code').value); });
document.getElementById('code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { initAudio(); joinGame(e.target.value); }
});

function resize() {
  if (!mouse.x && !mouse.y) { mouse.x = innerWidth / 2; mouse.y = innerHeight / 2; }
  VW = canvas.width = innerWidth;
  VH = canvas.height = innerHeight;
}
addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);

// для автотестов: ?autotest=jedi|smuggler сразу запускает одиночную игру
const auto = new URLSearchParams(location.search).get('autotest');
if (auto && CLASSES[auto]) {
  G.cls = auto;
  document.getElementById('btnSolo').click();
}
